import {DeleteParams, GetParams, Item, KeyAttributes, KeyValue, ProjectionKeys, PutParams} from './types';
import {BatchGetCommand, BatchGetCommandInput, BatchWriteCommand, BatchWriteCommandInput} from '@aws-sdk/lib-dynamodb';
import {DynamoWrapper} from './DynamoWrapper';
import {DynamoModel} from './DynamoModel';
import {createDeleteRequest, createPutRequest, getReturnedConsumedCapacity} from './requests';
import {getKeyValues, parseRequest} from './utils';

type BatchItem<T extends Item = Item> = {
  model: DynamoModel<T>;
  item: T;
};

type BatchCommand<T extends Item = Item> = {
  model: DynamoModel<T>;
  command: 'put' | 'delete';
  key: KeyValue<T, KeyAttributes<T>>
};

type BatchResult<T> = {
  items: T[];
  done: boolean;
};

async function* batchResultIterator<T>(execute: () => Promise<BatchResult<T>>): AsyncGenerator<T> {
  let delay = 100;

  while (true) {
    const {items, done} = await execute();

    for (const item of items) {
      yield item;
    }

    if (done) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, Math.random() * delay));
    delay *= 2;
  }
}

export class DynamoBatchStatementProxy extends DynamoWrapper {
  get<T extends Item, K extends KeyAttributes<T>, P extends ProjectionKeys<T>>(
      model: DynamoModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoBatchGetStatement<T> {
    return new DynamoBatchGetStatement<T>(this.client, this.name).get(model, ...paramsList);
  }

  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
  ): DynamoBatchWriteStatement<T> {
    return new DynamoBatchWriteStatement<T>(this.client, this.name).put(model, ...paramsList);
  }

  delete<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<Pick<DeleteParams<T, K>, 'key'>>
  ): DynamoBatchWriteStatement<T> {
    return new DynamoBatchWriteStatement<T>(this.client, this.name).delete(model, ...paramsList);
  }
}

export class DynamoBatchGetStatement<T0 extends Item> extends DynamoWrapper {
  private requestMap: NonNullable<BatchGetCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  get<T extends Item, K extends KeyAttributes<T>, P extends ProjectionKeys<T>>(
      model: DynamoModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoBatchGetStatement<T0 | T> {
    for (const params of paramsList) {
      let keys = this.requestMap[model.tableName]?.Keys;

      if (!keys) {
        this.requestMap[model.tableName] = {Keys: keys = []};
      }
      keys.push(params.key);
      this.modelMap.set(model.tableName, model);
    }

    return this as any;
  }

  /**
   * Execute the statements in this batch and return the retrieved items.
   * Note that while done is false, some statements were not executed and this method should then be called again,
   * preferably after utilizing exponential backoff.
   */
  async execute<T extends Item = T0>(): Promise<BatchResult<BatchItem<T>>> {
    const {Responses: itemMap = {}, UnprocessedKeys: nextRequestMap} = await this.command(
        new BatchGetCommand({
          RequestItems: this.requestMap,
          ReturnConsumedCapacity: getReturnedConsumedCapacity(this)
        }));
    const items: Array<BatchItem<any>> = [];

    for (const [tableName, tableItems] of Object.entries(itemMap)) {
      const model = this.modelMap.get(tableName)!;

      for (const item of tableItems) {
        items.push({model, item});
      }
    }

    this.requestMap = nextRequestMap ?? {};

    // Keys that don't exist end up as unprocessed items, so clients should only loop if !done && items.length > 0,
    // otherwise there will be an infinite loop trying to fetch non-existent items.

    return {
      items,
      done: Object.keys(this.requestMap).length === 0
    };
  }

  /**
   * Returns an iterator which executes the statements in this batch and returns the retrieved items until done,
   * adding a random delay between batches.
   */
  async *executeIterator<T extends Item = T0>(): AsyncGenerator<BatchItem<T>> {
    yield* batchResultIterator(() => this.execute<T>());
  }
}

export class DynamoBatchWriteStatement<T0 extends Item> extends DynamoWrapper {
  private requestMap: NonNullable<BatchWriteCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
  ): DynamoBatchWriteStatement<T0 | T> {
    for (const params of paramsList) {
      let requestItems = this.requestMap[model.tableName];

      if (!requestItems) {
        this.requestMap[model.tableName] = requestItems = [];
      }

      requestItems.push({PutRequest: createPutRequest(model, params)});
      this.modelMap.set(model.tableName, model);
    }

    return this;
  }

  delete<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<Pick<DeleteParams<T, K>, 'key'>>
  ): DynamoBatchWriteStatement<T0 | T> {
    for (const params of paramsList) {
      let requestItems = this.requestMap[model.tableName];

      if (!requestItems) {
        this.requestMap[model.tableName] = requestItems = [];
      }

      requestItems.push({DeleteRequest: createDeleteRequest(model, params)});
      this.modelMap.set(model.tableName, model);
    }

    return this;
  }

  /**
   * Execute the statements in this batch. Note that while done is false, some statements were not executed and this
   * method should then be called again, preferably after utilizing exponential backoff.
   */
  async execute<T extends Item = T0>(): Promise<BatchResult<BatchCommand<T>>> {
    const {UnprocessedItems: nextRequestMap} = await this.command(
        new BatchWriteCommand({
          RequestItems: this.requestMap,
          ReturnConsumedCapacity: getReturnedConsumedCapacity(this)
        }));

    const items: Array<BatchCommand<any>> = [];

    for (const [tableName, requests] of Object.entries(this.requestMap)) {
      const model = this.modelMap.get(tableName)!;

      const nextKeyValues = nextRequestMap?.[tableName]?.map(request =>
          JSON.stringify(getKeyValues(parseRequest(request).key, model.params.keyAttributes)));

      for (const request of requests) {
        const {key, command} = parseRequest(request);
        const keyValue = JSON.stringify(getKeyValues(key, model.params.keyAttributes));

        if (!nextKeyValues?.some(v => v === keyValue)) {
          // This request was processed
          model.params.triggers.forEach(trigger => trigger(key, command, model));
          items.push({model, command, key} as BatchCommand<any>);
        }
      }
    }

    this.requestMap = nextRequestMap ?? {};

    return {
      items,
      done: Object.keys(this.requestMap).length === 0
    };
  }

  /**
   * Returns an iterator which executes the statements in this batch until done, adding a random delay between batches.
   */
  async *executeIterator<T extends Item = T0>(): AsyncGenerator<BatchCommand<T>> {
    yield* batchResultIterator(() => this.execute<T>());
  }
}

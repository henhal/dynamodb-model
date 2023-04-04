import {DeleteParams, GetParams, Item, KeyAttributes, PutParams} from './types';
import {BatchGetCommand, BatchGetCommandInput, BatchWriteCommand, BatchWriteCommandInput} from '@aws-sdk/lib-dynamodb';
import {DynamoWrapper} from './DynamoWrapper';
import {DynamoModel} from './DynamoModel';
import {createDeleteRequest, createGetRequest, createPutRequest} from './requests';
import {getKeyValues, parseRequest} from './utils';

type BatchItem<T extends Item = Item> = {
  model: DynamoModel<T>;
  item: T;
};

export class DynamoBatchStatementProxy extends DynamoWrapper {
  get<T extends Item, K extends KeyAttributes<T>, P extends keyof T>(
      model: DynamoModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoBatchGetStatement {
    return new DynamoBatchGetStatement(this.client, this.name).get(model, ...paramsList);
  }

  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
  ): DynamoBatchWriteStatement {
    return new DynamoBatchWriteStatement(this.client, this.name).put(model, ...paramsList);
  }

  delete<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<Pick<DeleteParams<T, K>, 'key'>>
  ): DynamoBatchWriteStatement {
    return new DynamoBatchWriteStatement(this.client, this.name).delete(model, ...paramsList);
  }
}

export class DynamoBatchGetStatement extends DynamoWrapper {
  private requestMap: NonNullable<BatchGetCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  get<T extends Item, K extends KeyAttributes<T>, P extends keyof T>(
      model: DynamoModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoBatchGetStatement {
    for (const params of paramsList) {
      let keys = this.requestMap[model.tableName]?.Keys;

      if (!keys) {
        this.requestMap[model.tableName] = {Keys: keys = []};
      }
      keys.push(createGetRequest(model, params));
      this.modelMap.set(model.tableName, model);
    }

    return this;
  }

  async execute(): Promise<{items: Array<BatchItem>; done: boolean}> {
    const {Responses: itemMap = {}, UnprocessedKeys: nextRequestMap} = await this.command(
        new BatchGetCommand({RequestItems: this.requestMap}),
        (dc, cmd) => dc.send(cmd));
    const items: Array<BatchItem> = [];

    for (const [tableName, tableItems] of Object.entries(itemMap)) {
      const model = this.modelMap.get(tableName)!;

      for (const item of tableItems) {
        items.push({model, item});
      }
    }

    this.requestMap = nextRequestMap ?? {};

    return {items, done: !nextRequestMap};
  }
}

export class DynamoBatchWriteStatement extends DynamoWrapper {
  private requestMap: NonNullable<BatchWriteCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
  ): DynamoBatchWriteStatement {
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
  ): DynamoBatchWriteStatement {
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

  async execute(): Promise<{done: boolean;}> {
    const {UnprocessedItems: nextRequestMap} = await this.command(
        new BatchWriteCommand({RequestItems: this.requestMap}),
        (dc, cmd) => dc.send(cmd));

    for (const [tableName, requests] of Object.entries(this.requestMap)) {
      const model = this.modelMap.get(tableName)!;

      const nextKeyValues = nextRequestMap?.[tableName]?.map(request =>
          JSON.stringify(getKeyValues(parseRequest(request).key, model.params.keyAttributes)));

      for (const request of requests) {
        const {key, command} = parseRequest(request);
        const keyValue = JSON.stringify(getKeyValues(key, model.params.keyAttributes));

        if (!nextKeyValues?.some(v => v === keyValue)) {
          model.params.triggers.forEach(trigger => trigger(key, command, model));
        }
      }
    }

    this.requestMap = nextRequestMap ?? {};

    return {done: !nextRequestMap};
  }
}

import {TransactionCanceledException} from '@aws-sdk/client-dynamodb';
import {
  TransactGetCommand,
  TransactGetCommandInput,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {DynamoModel} from './DynamoModel';
import {DynamoWrapper} from './DynamoWrapper';
import {
  createConditionCheckRequest,
  createDeleteRequest,
  createGetRequest,
  createPutRequest,
  createUpdateRequest,
  getReturnedConsumedCapacity,
} from './requests';

import {
  ConditionCheckParams,
  DeleteParams,
  GetParams,
  Item,
  KeyAttributes,
  ProjectionKeys,
  PutParams,
  UpdateParams
} from './types';
import {parseRequest} from './utils';

export class DynamoTransactionProxy extends DynamoWrapper {
  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<PutParams<T, B>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client, this.name).put(model, ...paramsList);
  }

  update<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, B>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client, this.name).update(model, ...paramsList);
  }

  delete<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<DeleteParams<T, K>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client, this.name).delete(model, ...paramsList);
  }

  get<T extends Item, K extends KeyAttributes<T>, P extends ProjectionKeys<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoGetTransaction {
    return new DynamoGetTransaction(this.client, this.name).get(model, ...paramsList);
  }
}

export abstract class DynamoTransaction extends DynamoWrapper {
  err?: any;

  static isTransactionCancelled(err: any): err is TransactionCanceledException {
    return err?.name === 'TransactionCanceledException';
  }

  static conditionalCheckFailed(err: any): boolean {
    return !!(DynamoTransaction.isTransactionCancelled(err) &&
        err.CancellationReasons?.some(r => r.Code === 'ConditionalCheckFailed'));
  }

  /**
   * Check if the most recent commit threw a transaction cancelled error, e.g. due to conditions failing or
   * concurrency constraints not being fulfilled.
   */
  isTransactionCancelled(): boolean {
    return DynamoTransaction.isTransactionCancelled(this.err);
  }

  /**
   * Check if the most recent commit threw an error containing at least one failed condition check
   */
  conditionalCheckFailed(): boolean {
    return DynamoTransaction.conditionalCheckFailed(this.err);
  }
}

export class DynamoGetTransaction extends DynamoTransaction {
  private readonly items: NonNullable<TransactGetCommandInput['TransactItems']> = [];

  get<T extends Item, K extends KeyAttributes<T>, P extends ProjectionKeys<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoGetTransaction {
    this.items.push(...paramsList.map(params => ({Get: createGetRequest(model, params)})));

    return this;
  }

  async commit(): Promise<void> {
    try {
      await this.command(new TransactGetCommand({
        TransactItems: this.items,
        ReturnConsumedCapacity: getReturnedConsumedCapacity(this)
      }));
    } catch (err) {
      this.err = err;
      throw err;
    }
  }
}

export class DynamoWriteTransaction extends DynamoTransaction {
  private readonly items: NonNullable<TransactWriteCommandInput['TransactItems']> = [];
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  put<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<PutParams<T, B>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({
      Put: createPutRequest(model, params)
    })));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  update<T extends Item, K extends KeyAttributes<T>, B extends Item>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, B>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({
      Update: createUpdateRequest(model, params)
    })));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  delete<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<DeleteParams<T, K>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({
      Delete: createDeleteRequest(model, params)
    })));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  condition<T extends Item, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<ConditionCheckParams<T, K>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({ConditionCheck: createConditionCheckRequest(model, params)})));

    return this;
  }

  async commit(token?: string): Promise<void> {
    try {
      await this.command(new TransactWriteCommand({
        TransactItems: this.items,
        ClientRequestToken: token,
        ReturnConsumedCapacity: getReturnedConsumedCapacity(this)
      }));
    } catch (err) {
      this.err = err;
      throw err;
    }

    this.items.forEach(item => {
      const {tableName, key, command} = parseRequest(item)
      const model = this.modelMap.get(tableName!);

      model?.params.triggers.forEach(trigger => trigger(key, command, model));
    });
  }
}
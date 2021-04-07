import {TransactionCanceledException} from '@aws-sdk/client-dynamodb';
import {
  TransactGetCommand,
  TransactGetCommandInput,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';

import {ConditionCheckParams, DeleteParams, GetParams, KeyAttributes, PutParams, UpdateParams} from './types';
import {
  createConditionCheckRequest,
  createDeleteRequest,
  createGetRequest,
  createPutRequest,
  createUpdateRequest,
} from './requests';
import {DynamoModel} from './DynamoModel';
import {DynamoWrapper} from './DynamoWrapper';
import {parseRequest} from './utils';

export class DynamoTransactionProxy extends DynamoWrapper {
  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoModel<T, K, any,B>,
      ...paramsList: Array<PutParams<T, B>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client).put(model, ...paramsList);
  }

  update<T, K extends KeyAttributes<T>, B>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, B>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client).update(model, ...paramsList);
  }

  delete<T, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<DeleteParams<T, K>>
  ): DynamoWriteTransaction {
    return new DynamoWriteTransaction(this.client).delete(model, ...paramsList);
  }

  get<T, K extends KeyAttributes<T>, P extends keyof T>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoGetTransaction {
    return new DynamoGetTransaction(this.client).get(model, ...paramsList);
  }
}

export abstract class DynamoTransaction extends DynamoWrapper {
  err?: any;

  private static isTransactionCancelled(err: any): err is TransactionCanceledException {
    return err?.name === 'TransactionCanceledException';
  }

  transactionCancelled(): boolean {
    return DynamoTransaction.isTransactionCancelled(this.err);
  }

  conditionalCheckFailed(): boolean {
    return !!(DynamoTransaction.isTransactionCancelled(this.err) &&
        this.err.CancellationReasons?.some(r => r.Code === 'ConditionalCheckFailed'));
  }
}

export class DynamoGetTransaction extends DynamoTransaction {
  private readonly items: NonNullable<TransactGetCommandInput['TransactItems']> = [];

  get<T, K extends KeyAttributes<T>, P extends keyof T>(
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
      }), (dc, cmd) => dc.send(cmd));
    } catch (err) {
      this.err = err;
      throw err;
    }
  }
}

export class DynamoWriteTransaction extends DynamoTransaction {
  private readonly items: NonNullable<TransactWriteCommandInput['TransactItems']> = [];
  private readonly modelMap = new Map<string, DynamoModel<any>>();

  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoModel<T, K, any,B>,
      ...paramsList: Array<PutParams<T, B>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({Put: createPutRequest(model, params)})));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  update<T, K extends KeyAttributes<T>, B>(
      model: DynamoModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, B>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({Update: createUpdateRequest(model, params)})));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  delete<T, K extends KeyAttributes<T>>(
      model: DynamoModel<T, K>,
      ...paramsList: Array<DeleteParams<T, K>>
  ): DynamoWriteTransaction {
    this.items.push(...paramsList.map(params => ({Delete: createDeleteRequest(model, params)})));
    this.modelMap.set(model.tableName, model);

    return this;
  }

  condition<T, K extends KeyAttributes<T>>(
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
        ClientRequestToken: token
      }), (dc, cmd) => dc.send(cmd));
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
import {DynamoDBDocument, DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {Item} from './types';
import {DynamoTransactionProxy} from './DynamoTransaction';
import {DynamoModelBuilder} from './DynamoModel';
import {DynamoBatchStatementProxy} from './DynamoBatch';
import {DynamoDBClient} from '@aws-sdk/client-dynamodb';

function defaultDc() {
  return DynamoDBDocument.from(new DynamoDBClient({}));
}

type Logger = {
  debug: (...args: any[]) => void
};

export interface Options {
  logger?: Logger;
}

export class DynamoClient {
  constructor(
      readonly dc: DynamoDBDocumentClient = defaultDc(),
      readonly options: Options = {}) {
  }

  model<T extends Item>(name: string, tableName: string = name): DynamoModelBuilder<T> {
    return new DynamoModelBuilder<T>(this, name, tableName);
  }

  transaction(): DynamoTransactionProxy {
    return new DynamoTransactionProxy(this);
  }

  batch(): DynamoBatchStatementProxy {
    return new DynamoBatchStatementProxy(this);
  }
}




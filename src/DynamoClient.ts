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

/**
 * A DynamoDB client
 */
export class DynamoClient {
  constructor(
      readonly dc: DynamoDBDocumentClient = defaultDc(),
      readonly options: Options = {}) {
  }

  /**
   * Create a model for a DynamoDB table
   * @param name Name of the model
   * @param tableName Name of the table
   */
  model<T extends Item>(name: string, tableName: string = name): DynamoModelBuilder<T> {
    return new DynamoModelBuilder<T>(this, name, tableName);
  }

  /**
   * Create a transaction
   * @param [name] Optional name identifying the transaction for logging etc.
   */
  transaction(name?: string): DynamoTransactionProxy {
    return new DynamoTransactionProxy(this, name);
  }

  /**
   * Create a batch statement
   * @param [name] Optional name identifying the statement for logging etc.
   */
  batch(name?: string): DynamoBatchStatementProxy {
    return new DynamoBatchStatementProxy(this, name);
  }
}




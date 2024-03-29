import {DynamoDBClient} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocument, DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';

import {DynamoBatchStatementProxy} from './DynamoBatch';
import {DynamoModelBuilder} from './DynamoModel';
import {DynamoTransactionProxy} from './DynamoTransaction';
import {Item} from './types';

function defaultDc() {
  return DynamoDBDocument.from(new DynamoDBClient({}));
}

type Logger = {
  /**
   * Write debug logs. This should be able to log both strings and objects in human-readable format.
   * @param args
   */
  debug: (...args: any[]) => void
};

/**
 * DynamoClient options
 */
export interface Options {
  /**
   * A logger used for debugging. This will log the complete input and output of all commands.
   */
  logger?: Logger;

  /**
   * Whether to enable table metrics
   */
  enableTableMetrics?: boolean;
}

/**
 * Metrics for a table
 */
export interface TableMetrics {
  /**
   * The name of the table
   */
  tableName: string;
  /**
   * The consumed read capacity units
   */
  rcu?: number;
  /**
   * The consumed write capacity units
   */
  wcu?: number;
  /**
   * The consumed combined capacity units
   */
  cu?: number;
}

/**
 * A DynamoDB client
 */
export class DynamoClient {
  private tableMetrics = new Map<string, TableMetrics>();

  /**
   * Create a model for a DynamoDB table without supplying the runtime parameters.
   * @returns a builder used to build a model.
   */
  static model<T extends Item>(): DynamoModelBuilder<T> {
    return new DynamoModelBuilder<T>();
  }

  constructor(
      readonly dc: DynamoDBDocumentClient = defaultDc(),
      readonly options: Options = {}) {
  }

  /**
   * Create a model for a DynamoDB table
   * @param name Name of the model
   * @param tableName Name of the table
   * @returns a builder used to build a model.
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

  /**
   * Get metrics for each table operated on by this client instance.
   * For metrics to be collected, the option enableTableMetrics must be true when constructing the client.
   */
  getTableMetrics(): Map<string, TableMetrics> {
    return this.tableMetrics;
  }

  /**
   * Clear the table metrics
   */
  clearTableMetrics(): void {
    this.tableMetrics = new Map();
  }
}




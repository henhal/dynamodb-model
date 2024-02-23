import {ConsumedCapacity, ServiceInputTypes, ServiceOutputTypes} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {Command} from '@aws-sdk/types'

import {DynamoClient} from './DynamoClient';

type DynamoDbCommand<I, O> = Command<any, I, any, O, any>;
type DynamoDbInput = ServiceInputTypes;
type DynamoDbOutput = ServiceOutputTypes;
type DynamoDbCommandExecutor<I extends DynamoDbInput, O extends DynamoDbOutput> = (client: DynamoDBDocumentClient, cmd: DynamoDbCommand<I, O>) => Promise<O>;

export abstract class DynamoWrapper {
  constructor(readonly client: DynamoClient, readonly name?: string) {
  }

  protected get logger() {
    return this.client.options.logger;
  }

  protected async command<I extends DynamoDbInput, O extends DynamoDbOutput>(
      cmd: DynamoDbCommand<I, O>,
      executor: DynamoDbCommandExecutor<I, O> = (client, cmd) => client.send(cmd)
  ): Promise<O> {
    const command = cmd.constructor.name;
    const {input} = cmd;

    try {
      this.logger?.debug({input}, `DynamoDB ${command} input`);
      const output = await executor(this.client.dc, cmd);
      if ('ConsumedCapacity' in output) {
        this.logConsumedCapacity(output.ConsumedCapacity);
      }
      this.logger?.debug({output}, `DynamoDB ${command} output`);
      return output;
    } catch (err: any) {
      this.logger?.debug({err}, `DynamoDB ${command} error: ${err.message}`);
      throw err;
    }
  }

  private logConsumedCapacity(consumedCapacity: ConsumedCapacity | ConsumedCapacity[] = []): void {
    const items = Array.isArray(consumedCapacity) ? consumedCapacity : [consumedCapacity];
    const tableMetrics = this.client.getTableMetrics();

    for (const item of items) {
      const {
        TableName: tableName,
        ReadCapacityUnits: rcu = 0,
        WriteCapacityUnits: wcu = 0
      } = item;

      if (tableName) {
        const metrics = tableMetrics.get(tableName);

        if (metrics) {
          metrics.rcu += rcu;
          metrics.wcu += wcu;
        } else {
          tableMetrics.set(tableName, {
            tableName,
            rcu,
            wcu
          });
        }
      }
    }
  }
}


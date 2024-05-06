import {ConsumedCapacity, ServiceInputTypes, ServiceOutputTypes} from '@aws-sdk/client-dynamodb';
import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {Command} from '@aws-sdk/types'

import {DynamoClient} from './DynamoClient';

type DynamoDbCommand<I, O> = Command<any, I, any, O, any>;
type DynamoDbInput = ServiceInputTypes;
type DynamoDbOutput = ServiceOutputTypes;
type DynamoDbCommandExecutor<I extends DynamoDbInput, O extends DynamoDbOutput> = (client: DynamoDBDocumentClient, cmd: DynamoDbCommand<I, O>) => Promise<O>;

function truncate(data: unknown): unknown {
  if (data == null) {
    return data;
  } else if (Array.isArray(data)) {
    const result = data.slice(0, 2).map(truncate);
    const rest = data.length - result.length;

    if (rest > 0) {
      result.push(` ... ${rest} more items`)
    }
    return result;
  } else if (typeof data === 'object') {
    const result: Record<string, any> = {};

    for (const [k, v] of Object.entries(data)) {
      result[k] = truncate(v);
    }
    return result;
  } else {
    return data;
  }
}

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
      this.logger?.debug({input: truncate(input)}, `DynamoDB ${command} input`);
      const output = await executor(this.client.dc, cmd);
      if ('ConsumedCapacity' in output) {
        this.logConsumedCapacity(output.ConsumedCapacity);
      }
      this.logger?.debug({output: truncate(output)}, `DynamoDB ${command} output`);
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
        ReadCapacityUnits: rcu ,
        WriteCapacityUnits: wcu ,
        CapacityUnits: cu
      } = item;

      if (tableName) {
        const metrics = tableMetrics.get(tableName);

        if (metrics) {
          if (rcu) {
            metrics.rcu = (metrics.rcu ?? 0) + rcu;
          }
          if (wcu) {
            metrics.wcu = (metrics.wcu ?? 0) + wcu;
          }
          if (cu) {
            metrics.cu = (metrics.cu ?? 0) + cu;
          }
        } else {
          tableMetrics.set(tableName, {
            tableName,
            rcu,
            wcu,
            cu
          });
        }
      }
    }
  }
}


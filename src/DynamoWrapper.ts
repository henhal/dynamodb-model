import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {DynamoClient} from './DynamoClient';

type DynamoDbCommand = {input: any};

export abstract class DynamoWrapper {
  constructor(readonly client: DynamoClient) {
  }

  private get logger() {
    return this.client.options.logger;
  }

  protected async command<C extends DynamoDbCommand, O>(cmd: C, f: (dc: DynamoDBDocumentClient, cmd: C) => Promise<O>): Promise<O> {
    const tag = cmd.constructor.name;

    try {
      this.logger?.debug(`[${tag}] Input:\n${JSON.stringify(cmd.input, null, 2)}`);
      const output = await f(this.client.dc, cmd);
      this.logger?.debug(`[${tag}] Output:\n${JSON.stringify(output, null, 2)}`);
      return output;
    } catch (err) {
      this.logger?.debug(`[${tag}] Error: ${err}`);
      throw err;
    }
  }
}
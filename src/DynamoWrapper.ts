import {DynamoDBDocumentClient} from '@aws-sdk/lib-dynamodb';
import {DynamoClient} from './DynamoClient';

type DynamoDbCommand = {input: any};

export abstract class DynamoWrapper {
  constructor(readonly client: DynamoClient, readonly name?: string) {
  }

  private get logger() {
    return this.client.options.logger;
  }

  protected async command<C extends DynamoDbCommand, O>(cmd: C, f: (dc: DynamoDBDocumentClient, cmd: C) => Promise<O>): Promise<O> {
    const command = cmd.constructor.name;
    const {input} = cmd;

    try {
      this.logger?.debug({input}, `DynamoDB ${command} input`);
      const output = await f(this.client.dc, cmd);
      this.logger?.debug({output}, `DynamoDB ${command} output`);
      return output;
    } catch (err: any) {
      this.logger?.debug({err}, `DynamoDB ${command} error: ${err.message}`);
      throw err;
    }
  }
}
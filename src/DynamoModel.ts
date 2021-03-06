import {
  DeleteParams,
  GetParams, GetResult, Item, Key,
  KeyAttributes,
  KeyIndices,
  ModelParams, PutParams, QueryParams,
  ScanParams,
  ScanResult, Trigger,
  UpdateParams,
} from './types';
import {DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {DynamoClient} from './DynamoClient';
import {
  createDeleteRequest, createGetRequest,
  createPutRequest,
  createQueryRequest,
  createScanRequest,
  createUpdateRequest,
} from './requests';
import {formatPageToken} from './utils';
import {DynamoWrapper} from './DynamoWrapper';

/**
 * A model representing a DynamoDB table
 */
export class DynamoModel<T extends Item, K extends KeyAttributes<T> = any, I extends KeyIndices<T> = any, B = any> extends DynamoWrapper {
  constructor(
      client: DynamoClient,
      readonly name: string,
      readonly tableName: string,
      readonly params: ModelParams<T, K, I, B>
  ) {
    super(client);
  }

  async get<P extends keyof T>(
      params: GetParams<T, K, P>
  ): Promise<GetResult<T>> {
    const {Item: item} = await this.command(
        new GetCommand(createGetRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return item as GetResult<T>;
  }

  async scan<P extends keyof T, N extends string, >(
      params: ScanParams<T, P, N> = {}
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new ScanCommand(createScanRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }

  async query<P extends keyof T, N extends string>(
      params: QueryParams<T, P, N, Key<T, N extends keyof I ? I[N] : K>>
  ): Promise<ScanResult<T, P>> {

    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new QueryCommand(createQueryRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }

  async put(
      params: PutParams<T, B>
  ): Promise<{item: T}> {
    await this.command(
        new PutCommand(createPutRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = params.item as T;

    this.params.triggers.forEach(trigger => trigger(item, 'put', this));

    return {item};
  }

  async update(
      params: UpdateParams<T, K, B>
  ): Promise<{item: T}> {
    const {Attributes: attributes} = await this.command(
        new UpdateCommand(createUpdateRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = attributes as T;

    this.params.triggers.forEach(trigger => trigger(item, 'update', this));

    return {item};
  }

  async delete(
      params: DeleteParams<T, K>
  ): Promise<void> {
    const {Attributes: attributes} = await this.command(
        new DeleteCommand(createDeleteRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = attributes as T;

    this.params.triggers.forEach(trigger => trigger(item, 'delete', this));
  }
}

/**
 * A model builder
 */
export class DynamoModelBuilder<T extends Item, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}, B = {}> extends DynamoWrapper {
  private readonly params: ModelParams<T, K, I, B> = {
    indices: {} as I,
    creators: [],
    updaters: [],
    triggers: []
  };

  constructor(client: DynamoClient, readonly name: string, readonly tableName: string) {
    super(client);
  }

  /**
   * Define the key attribute(s) of this model
   * @param keyAttributes One or two attribute names identifying the HASH and RANGE keys of the table
   */
  withKey<_K extends KeyAttributes<T>>(...keyAttributes: _K): DynamoModelBuilder<T, _K> {
    const builder = this as unknown as DynamoModelBuilder<T, _K>;
    builder.params.keyAttributes = keyAttributes;

    return builder;
  }

  /**
   * Add an index to this model
   * @param name Name of the index
   * @param indexAttributes One or two attribute names identifying the HASH and RANGE keys of the index
   */
  withIndex<N extends string, IK extends KeyAttributes<T>>(name: N, ...indexAttributes: IK): DynamoModelBuilder<T, K, I & Record<N, IK>> {
    const builder = this as unknown as DynamoModelBuilder<T, K, I & Record<N, IK>>;

    builder.params.indices[name] = indexAttributes as any;

    return builder;
  }

  /**
   * Add an item creator function that adds or modifies item attributes prior to calling put.
   * This can for example be used to automatically create timestamps or auto-generated IDs when creating items.
   * @param creator A function that may modify items being put.
   */
  // Ideally this would be item: WrittenItem<T, _B> but then _B cannot be inferred from the return type
  withCreator<_B>(creator: (item: T) => _B) {
    const builder = this as unknown as DynamoModelBuilder<T & _B, K, I, B & _B>;

    builder.params.creators.push(creator);

    return builder;
  }

  /**
   * Add an item updater function that adds or modifies item attributes prior to calling update.
   * This can for example be used to automatically update timestamps when updating items.
   * @param updater A function that may modify items being updated.
   */
  withUpdater(updater: (item: Partial<T>) => Partial<T>) {
    this.params.updaters.push(updater);

    return this;
  }

  /**
   * Add a trigger to be called after each successful table write operation.
   * @param trigger
   */
  withTrigger(trigger: Trigger<T, K>) {
    this.params.triggers.push(trigger);

    return this;
  }

  /**
   * Build the model
   */
  build(): DynamoModel<T, K, I, B> {
    return new DynamoModel(this.client, this.name, this.tableName, this.params);
  }
}
import {DeleteCommand, GetCommand, PutCommand, QueryCommand, ScanCommand, UpdateCommand} from '@aws-sdk/lib-dynamodb';
import {DynamoClient} from './DynamoClient';
import {DynamoWrapper} from './DynamoWrapper';
import {
  createDeleteRequest,
  createGetRequest,
  createPutRequest,
  createQueryRequest,
  createScanRequest,
  createUpdateRequest,
} from './requests';
import {
  DeleteParams,
  GetParams,
  GetResult,
  Item,
  ItemConverter,
  Key,
  KeyAttributes,
  KeyIndices,
  ModelParams,
  PutParams,
  QueryParams,
  ScanParams,
  ScanResult,
  Trigger,
  UpdateParams,
} from './types';
import {formatPageToken, StringKeyOf} from './utils';

/**
 * A model representing a DynamoDB table.
 * Type params:
 * * T represents the data stored in the table.
 * * K represents the table key definition, which is either a single or a tuple key
 * * I represents a dictionary of index names to index key definitions
 * * B represents data being automatically created by one or more creator functions, e.g. automatic timestamp generators.
 *   This type may contain parts of T, meaning that added items only need to contain attributes of T
 *   which aren't in type B.
 */
export class DynamoModel<T extends Item, K extends KeyAttributes<T> = any, I extends KeyIndices<T> = any, B = any> extends DynamoWrapper {
  static builder<T extends Item>(): DynamoModelBuilder<T> {
    return new DynamoModelBuilder<T>();
  }

  constructor(
      client: DynamoClient,
      readonly name: string,
      readonly tableName: string,
      readonly params: ModelParams<T, K, I, B>
  ) {
    super(client);
  }

  private convertItem<P extends keyof T = keyof T>(item: any, projection?: P[]): Pick<T, P> {
    const {converters} = this.params;

    if (converters) {
      for (const converter of converters) {
        converter(item, projection);
      }
    }

    return item as Pick<T, P>;
  }

  private convertItems<P extends keyof T = keyof T>(items: any[], projection?: P[]): Array<Pick<T, P>> {
    const {converters} = this.params;

    if (converters) {
      for (const item of items) {
        for (const converter of converters) {
          converter(item, projection);
        }
      }
    }

    return items as Array<Pick<T, P>>;
  }

  /**
   * Get a single item
   * @param params
   */
  async get<P extends keyof T>(
      params: GetParams<T, K, P>
  ): Promise<GetResult<T>> {
    const {Item: item} = await this.command(
        new GetCommand(createGetRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    if (item) {
      return this.convertItem(item, params.projection) as T;
    }
  }

  /**
   * Perform a scan operation, i.e., a query without any key condition, and return a page of items.
   * @param params
   */
  async scan<P extends keyof T, N extends string, >(
      params: ScanParams<T, P, N> = {}
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new ScanCommand(createScanRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      items: this.convertItems(items, params.projection),
      nextPageToken: formatPageToken(lastKey),
    };
  }

  /**
   * Perform a scan operation, i.e., a query without any key condition, and return an item iterator.
   * @param params
   */
  async *scanIterator<P extends keyof T, N extends string, >(
      params: ScanParams<T, P, N> = {}
  ): AsyncGenerator<Pick<T, P>> {
    const p = {...params};
    do {
      const {items, nextPageToken} = await this.scan(p);

      for (const item of items) {
        yield item;
      }
      p.pageToken = nextPageToken;
    } while (p.pageToken);
  }

  /**
   * Perform a query operation with a key condition, and return a page of items.
   * @param params
   */
  async query<P extends keyof T, N extends StringKeyOf<I>>(
      params: QueryParams<T, P, N, Key<T, N extends keyof I ? I[N] : K>>
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new QueryCommand(createQueryRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      items: this.convertItems(items, params.projection),
      nextPageToken: formatPageToken(lastKey),
    };
  }

  /**
   * Perform a query operation with a key condition, and return an item iterator.
   * @param params
   */
  async *queryIterator<P extends keyof T, N extends StringKeyOf<I>>(
      params: QueryParams<T, P, N, Key<T, N extends keyof I ? I[N] : K>>
  ): AsyncGenerator<Pick<T, P>> {
    const p = {...params};
    do {
      const {items, nextPageToken} = await this.query(p);

      for (const item of items) {
        yield item;
      }
      p.pageToken = nextPageToken;
    } while (p.pageToken);
  }

  /**
   * Put (upsert) an item. If no item with the same key exists, a new item is created; otherwise the existing item is
   * replaced.
   * Note that if the model has any creator functions, attributes of T which are also in B do not need to be provided,
   * such as generated timestamps, auto-generated IDs etc.
   * @param params
   */
  async put(
      params: PutParams<T, B>
  ): Promise<{item: T}> {
    await this.command(
        new PutCommand(createPutRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = this.convertItem(params.item);

    this.params.triggers.forEach(trigger => trigger(item, 'put', this));

    return {item};
  }

  async update(
      params: UpdateParams<T, K, B>
  ): Promise<{item: T}> {
    const {Attributes: attributes} = await this.command(
        new UpdateCommand(createUpdateRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = this.convertItem(attributes);

    this.params.triggers.forEach(trigger => trigger(item, 'update', this));

    return {item};
  }

  /**
   * Delete an item
   * @param params
   */
  async delete(
      params: DeleteParams<T, K>
  ): Promise<void> {
    const {Attributes: attributes} = await this.command(
        new DeleteCommand(createDeleteRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
    const item = this.convertItem(attributes);

    this.params.triggers.forEach(trigger => trigger(item, 'delete', this));
  }
}

/**
 * A model builder
 */
export class DynamoModelBuilder<T extends Item, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}, B = {}>  {
  private readonly params: ModelParams<T, K, I, B> = {
    indices: {} as I,
    creators: [],
    updaters: [],
    triggers: []
  };

  constructor(readonly client?: DynamoClient, readonly name?: string, readonly tableName?: string) {
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
  withIndex<N extends string, IK extends KeyAttributes<T>>(name: N, ...indexAttributes: IK): DynamoModelBuilder<T, K, I & Record<N, IK>, B> {
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
   * Set a converter function to convert items read from the database to the proper type, e.g. to convert legacy items
   * missing some attributes added later. This will be called for every item returned by a model operation.
   * Note that the function should modify the passed item.
   * @param converter
   */
  withConverter(converter: ItemConverter<T>) {
    if (!this.params.converters) {
      this.params.converters = [converter];
    } else {
      this.params.converters.push(converter);
    }

    return this;
  }

  /**
   * Define default values for stored legacy items
   * @param values An object containing default values to assign to returned model items missing these properties.
   */
  withDefaultValues(values: Partial<T>) {
    return this.withConverter(item => {
      for (const [k, v] of Object.entries(values)) {
        if (item[k] === undefined) {
          item[k] = v;
        }
      }
    });
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
   * Build an instance of the model
   * The arguments client, name and tableName may either be supplied to this method
   * or earlier when the builder is created
   */
  build(client = this.client, name = this.name, tableName = this.tableName): DynamoModel<T, K, I, B> {
    const {params} = this;

    if (!client || !name || !tableName) {
      throw new Error('Cannot build model without arguments. Either supply them when calling build() or when creating the DynamoBuilder instance.');
    }
    return new DynamoModel(client, name, tableName, params);
  }

  /**
   * Create a class for the model. This is convenient as it also creates a type that can be easily referred to instead
   * of complex generic types such as DynamoModel<MyItem, 'id', {modifiedTime: string}> etc.
   *
   * Usage:
   * class MyModel extends DynamoModel.builder<MyItem>().withKey('id').class() {}
   *
   * const model = new MyModel(client, 'foo');
   */
  class(): abstract new (client: DynamoClient, name: string, tableName?: string) => DynamoModel<T, K, I, B> {
    const {params} = this;

    return class extends DynamoModel<T, K, I, B> {
      constructor(client: DynamoClient, name: string, tableName = name) {
        super(client, name, tableName, params);
      }
    }
  }
}


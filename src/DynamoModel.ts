import {ConditionalCheckFailedException} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
  UpdateCommand,
  UpdateCommandOutput
} from '@aws-sdk/lib-dynamodb';
import {UpdateCommandInput} from '@aws-sdk/lib-dynamodb/dist-types/commands/UpdateCommand';
import {Condition, ConditionAttributes} from 'dynamodb-expressions';
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
  ItemResult,
  Key,
  KeyAttributes,
  KeyIndices,
  KeyValue,
  ModelParams,
  PutParams,
  QueryParams,
  ScanParams,
  ScanResult,
  Trigger,
  UpdateParams,
} from './types';
import {error, formatPageToken, StringKeyOf} from './utils';

export class ModelOptions {
  client?: DynamoClient;
  name?: string;
  tableName?: string;
}

export interface AtomicActionParams<T extends Item, K extends KeyAttributes<T>, C extends keyof T> {
  key: KeyValue<T, K>;
  conditionAttribute: C,
  maxAttempts?: number;
}

export interface AtomicActionFuncParams<T extends Item, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>,
  item?: T,
  conditions: ConditionAttributes<T>;
}

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
export class DynamoModel<T extends Item, K extends KeyAttributes<T> = any, I extends KeyIndices<T> = any, B extends Item = any> extends DynamoWrapper {
  /**
   * Check if an error returned by a DynamoModel is a conditional check failed error
   * @param err
   */
  static isConditionalCheckFailed(err: any): err is ConditionalCheckFailedException {
    return err?.name === 'ConditionalCheckFailedException';
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
        new GetCommand(createGetRequest(this, params)));

    if (item) {
      return this.convertItem(item, params.projection) as T;
    }
  }

  /**
   * Perform a scan operation, i.e., a query without any key condition, and return a page of items.
   * @param params
   */
  async scan<P extends keyof T, N extends StringKeyOf<I> | undefined>(
      params: ScanParams<T, P, N> = {}
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new ScanCommand(createScanRequest(this, params)));

    return {
      items: this.convertItems(items, params.projection),
      nextPageToken: formatPageToken(lastKey),
    };
  }

  /**
   * Perform a scan operation, i.e., a query without any key condition, and return an item iterator.
   * @param params
   */
  async *scanIterator<P extends keyof T, N extends StringKeyOf<I> | undefined >(
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
  async query<P extends keyof T, N extends StringKeyOf<I> | undefined>(
      params: QueryParams<T, P, N, Key<T, N extends keyof I ? I[N] : K>>
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new QueryCommand(createQueryRequest(this, params)));

    return {
      items: this.convertItems(items, params.projection),
      nextPageToken: formatPageToken(lastKey),
    };
  }

  /**
   * Perform a query operation with a key condition, and return an item iterator.
   * @param params
   */
  async *queryIterator<P extends keyof T, N extends StringKeyOf<I> | undefined>(
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
  ): Promise<ItemResult<T>> {
    await this.command(
        new PutCommand(createPutRequest(this, params)));
    const item = this.convertItem(params.item);

    this.params.triggers.forEach(trigger => trigger(item, 'put', this));

    return {item};
  }

  async update(
      params: UpdateParams<T, K, B>
  ): Promise<ItemResult<T>> {
    const {Attributes: attributes} = await this.command(
        new UpdateCommand(createUpdateRequest(this, params)));
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
        new DeleteCommand(createDeleteRequest(this, params)));
    const item = this.convertItem(attributes);

    this.params.triggers.forEach(trigger => trigger(item, 'delete', this));
  }

  /**
   * Perform an atomic read-modify-write action which fetches an item and calls the supplied function with a key,
   * the existing item if it exists, and a set of conditions used to verify that the item hasn't been changed
   * concurrently between the get and the performed action.
   * The function should update the model using those arguments, using e.g. put() or update().
   *
   * If the action fails due to a conditional check failed error, after a delay the item will be fetched again and
   * the function called again, up to a certain number of attempts.
   *
   * This enables putting or updating an item without overwriting data in case of concurrent modifications.
   * It relies on the conditionAttribute having a unique value after each update, such as a random version assigned
   * on each modification or a timestamp of sufficient accuracy being refreshed on each modification.
   * @param params
   * @param params.key Key of the item to perform the action on
   * @param params.conditionAttribute Name of attribute to condition the action on
   * @param [params.maxAttempts] Max number of attempts
   * @param action Function called to perform the action on the item
   */
  async atomicAction<C extends keyof T, R>(
      params: AtomicActionParams<T, K, C>,
      action: (params: AtomicActionFuncParams<T, K>) => Promise<R>
  ): Promise<R> {
    const {key, conditionAttribute, maxAttempts = 5} = params;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const item = await this.get({key});

      try {
        return await action({
          key,
          item,
          conditions: {
            [conditionAttribute]: item?.[conditionAttribute] ?? Condition.attributeNotExists()
          } as ConditionAttributes<T>
        });
      } catch (err) {
        this.logger?.debug({attempt, err}, 'Atomic action attempt failed');

        if (!DynamoModel.isConditionalCheckFailed(err)) {
          throw err;
        }

        await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
      }
    }

    throw new Error('Atomic action failed after max attempts');
  }
}

/**
 * A model builder
 */
export class DynamoModelBuilder<T extends Item, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}, B extends Item = {}>  {
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

    builder.params.creators.push(creator as any);

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
   * If the builder was created via the static method `DynamoClient.model()`, the options `client`, `name` and `tableName`
   * must be supplied now.
   * If the builder was created via the instance method `client.model(name, tableName)`, the arguments may be omitted,
   * but if present they will override any options supplied when the builder was created.
   */
  build(options: ModelOptions = {}): DynamoModel<T, K, I, B> {
    const {
      client = this.client || error('client not supplied'),
      name = this.name || error('name not supplied'),
      tableName = this.tableName || name
    } = options;

    return new DynamoModel(client, name, tableName, this.params);
  }

  /**
   * Create a class for the model. This is convenient as it also creates a type that can be easily referred to instead
   * of complex generic types such as DynamoModel<MyItem, 'id', {modifiedTime: string}> etc.
   *
   * If the builder was created via the static method `DynamoClient.model()`, the options `client`, `name` and `tableName`
   * must be supplied either as arguments to this method or as arguments to the returned constructor function on each instance
   * creation.
   * If the builder was created via the instance method `client.model(name, tableName)`, the arguments may be omitted both
   * from this method and the returned constructor function, but if present they will override any options supplied to
   * this method or when the builder was created.
   *
   * Usage:
   * class PersonModel extends DynamoClient.model<Person>()
   *   .withKey('id')
   *   .withIndex('name-age-index', 'name', 'age')
   *   .class() {}
   *
   * const persons = new PersonModel({client, name: 'foo'});
   */
  class(options: ModelOptions = {}): abstract new (options?: ModelOptions) => DynamoModel<T, K, I, B> {
    const builder = {...this, ...options};

    return class extends DynamoModel<T, K, I, B> {
      constructor(options: ModelOptions = {}) {
        const {
          client = builder.client || error('client not supplied'),
          name = builder.name || error('name not supplied'),
          tableName = builder.tableName || name
        } = options;
        super(client, name, tableName, builder.params);
      }
    }
  }
}


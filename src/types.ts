import {ConditionSet, UpdateAttributes} from 'dynamodb-expressions';
import {DynamoModel} from './DynamoModel';
import {StringKeyOf} from './utils';

// An item that can be put or updated.
// Note that B is _allowed_ to be written but could be overwritten by creators/updaters.

export type Item = Record<string, any>;

type Optional<T extends Item, B extends Item> = Omit<T, keyof B> & Partial<B>;

/**
 * The name of an attribute within K
 */
export type KeyAttribute<T> = StringKeyOf<T>;

type SingleKey<T> = [KeyAttribute<T>];
type TupleKey<T> = [KeyAttribute<T>, KeyAttribute<T>];

/**
 * The attributes defining a key; could either be a single [hash] key or a [hash, range] tuple.
 */
export type KeyAttributes<T> = SingleKey<T> | TupleKey<T>;

/**
 * Key name(s) in a single or tuple key
 */
export type Key<T, K extends KeyAttributes<T>> = K[number];
/**
 * A key value, such as {foo: 42} for a single key ['foo'] of a {foo: number, bar: string} model,
 * or {foo: 42, bar: 'hello'} for a tuple key ['foo', 'bar'] of the same model.
 */
export type KeyValue<T, K extends KeyAttributes<T>> = Pick<T, Key<T, K>>;

/**
 * Index definitions for a model, as a dictionary of names to key definitions
 */
export type KeyIndices<T, K extends string = string> = Record<K, KeyAttributes<T>>;

export type TriggerCommand = 'put' | 'update' | 'delete';
export type Trigger<T extends Item, K extends KeyAttributes<T>> =
    (key: KeyValue<T, K>, command: TriggerCommand, model: DynamoModel<T, K>) => void;

/**
 * A function converting an item stored in the database to the proper type of the model.
 *
 * Once this function returns, the passed item must be of type T, or if projection is given, of type Pick<T, P>.
 * @param item The raw item
 * @param [projection] An array containing which keys of the item are available, and hence which subset of T the item
 * must fulfill. If not present, the item must be of the full type T.
 */
export type ItemConverter<T> = <P extends keyof T>(item: any, projection?: P[]) => void;

export type ModelParams<T extends Item, K extends KeyAttributes<T>, I extends KeyIndices<T>, B> = {
  keyAttributes?: K;
  indices: I;
  creators: Array<(item: any) => Partial<B>>;
  updaters: Array<(attributes: any) => Partial<T>>;
  triggers: Array<Trigger<T, K>>;
  converters?: Array<ItemConverter<T>>;
};

export type ConsistencyLevel = 'eventual' | 'strong';

export interface GetParams<T extends Item, K extends KeyAttributes<T>, P extends keyof T = keyof T> {
  key: KeyValue<T, K>;
  projection?: Array<P>;
  consistency?: ConsistencyLevel;
}

export type GetResult<T extends Item> = T | undefined;

export type ItemResult<T extends Item> = {
  item: T;
}

export interface ScanResult<T extends Item, P extends keyof T = keyof T> {
  items: Array<Pick<T, P>>,
  nextPageToken?: string
}

export interface ScanParams<T extends Item, P extends keyof T = keyof T, N extends string | undefined = string | undefined, F extends keyof T = keyof T> {
  indexName?: N;
  pageToken?: string;
  limit?: number;
  projection?: Array<P>;
  filterConditions?: ConditionSet<Pick<T, F>>;
  consistency?: ConsistencyLevel;
}

// Filter on query may not include key attributes
export interface QueryParams<T extends Item, P extends keyof T = keyof T, N extends string | undefined = string | undefined, I extends keyof T = keyof T>
    extends ScanParams<T, P, N, Exclude<keyof T, I>> {
  keyConditions: ConditionSet<Pick<T, I>>;
  ascending?: boolean;
}

export interface PutParams<T extends Item, B extends Item> {
  item: Optional<T, B>;
  conditions?: ConditionSet<T>;
}

export interface DeleteParams<T extends Item, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

export interface UpdateParams<T extends Item, K extends KeyAttributes<T>, B extends Item> {
  key: KeyValue<T, K>;
  attributes: UpdateAttributes<Optional<T, B>>;
  conditions?: ConditionSet<T>;
}

export interface ConditionCheckParams<T, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

// Convenience types
/**
 * Obtain a type for the items handled by a model
 */
export type ModelItem<Model extends DynamoModel<any>> = Model extends DynamoModel<infer T> ?
    T :
    never;

/**
 * Obtain a type for the input item of a model, i.e., type T but with the attributes of type B being optional as
 * they are created automatically
 */
export type ModelInputItem<Model> = Model extends DynamoModel<infer T, infer K, infer I, infer B> ?
    Optional<T, B> :
    never;

/**
 * Obtain a type for the base item B of a model, i.e., the attributes that are created automatically
 */
export type ModelBaseItem<Model> = Model extends DynamoModel<infer T, infer K, infer I, infer B> ?
    B :
    never;

/**
 * Obtain the name(s) of the key attribute(s) of a model
 */
export type ModelKey<Model extends DynamoModel<any>> = Model extends DynamoModel<infer T, infer K> ?
    Key<T, K> :
    never;

/**
 * Obtain a type for key values of a model
 */
export type ModelKeyValue<Model extends DynamoModel<any>> = Model extends DynamoModel<infer T, infer K> ?
    KeyValue<T, K> :
    never;

/**
 * Obtain a type for index names of a model
 */
export type ModelIndexName<Model extends DynamoModel<any>> = Model extends DynamoModel<infer T, infer K, infer I> ?
    StringKeyOf<I> :
    never;

/**
 * Obtain the name(s) of the key attribute(s) of an index within a model
 */
export type ModelIndexKey<Model extends DynamoModel<any>, N extends ModelIndexName<Model>> =
    Model extends DynamoModel<infer T, infer K, infer I> ?
        Key<T, I[N]> :
        never;

/**
 * Obtain a type for key values of an index within a model
 */
export type ModelIndexKeyValue<Model extends DynamoModel<any>, N extends ModelIndexName<Model>> =
    Model extends DynamoModel<infer T, infer K, infer I> ?
        KeyValue<T, I[N]> :
        never;

/**
 * Obtain a type for the get params of a model
 */
export type ModelGetParams<Model extends DynamoModel<any>> = Parameters<Model['get']>[0];

/**
 * Obtain a type for the scan params of a model
 */
export type ModelScanParams<Model extends DynamoModel<any>> = Parameters<Model['scan']>[0];

/**
 * Obtain a type for the query params of a model
 */
export type ModelQueryParams<Model extends DynamoModel<any>> = Parameters<Model['query']>[0];

/**
 * Obtain a type for the put params of a model
 */
export type ModelPutParams<Model extends DynamoModel<any>> = Parameters<Model['put']>[0];

/**
 * Obtain a type for the update params of a model
 */
export type ModelUpdateParams<Model extends DynamoModel<any>> = Parameters<Model['update']>[0];

/**
 * Obtain a type for the delete params of a model
 */
export type ModelDeleteParams<Model extends DynamoModel<any>> = Parameters<Model['delete']>[0];

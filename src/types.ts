import {ConditionSet, UpdateAttributes} from 'dynamodb-expressions';
import {DynamoModel} from './DynamoModel';

// An item that can be put or updated.
// Note that B is _allowed_ to be written but could be overwritten by creators/updaters.

export type Item = Record<string, any>;

type Optional<T extends Item, B extends Item> = Omit<T, keyof B> & Partial<B>;

export type KeyAttribute<T> = keyof T & string;

export type KeyAttributes<T> = [KeyAttribute<T>] | [KeyAttribute<T>, KeyAttribute<T>];

export type Key<T, K extends KeyAttributes<T>> = K extends [KeyAttribute<T>, KeyAttribute<T>] ? K[1] | K[0] : K[0];
export type KeyValue<T, K extends KeyAttributes<T>> = Pick<T, Key<T, K>>;

export type KeyIndices<T> = Record<string, KeyAttributes<T>>;

export type TriggerCommand = 'put' | 'update' | 'delete';
export type Trigger<T, K extends KeyAttributes<T>> =
    (key: KeyValue<T, K>, command: TriggerCommand, model: DynamoModel<T, K>) => void;

export type ModelParams<T, K extends KeyAttributes<T>, I extends KeyIndices<T>, B> = {
  keyAttributes?: K;
  indices: I;
  creators: Array<(item: any) => Partial<B>>;
  updaters: Array<(attributes: any) => Partial<T>>;
  triggers: Array<Trigger<T, K>>;
};

export interface GetParams<T, K extends KeyAttributes<T>, P extends keyof T = keyof T> {
  key: KeyValue<T, K>;
  projection?: Array<P>;
}

export interface ScanResult<T, P extends keyof T = keyof T> {
  items: Array<Pick<T, P>>,
  nextPageToken?: string
}

export interface ScanParams<T, P extends keyof T = keyof T, N extends string = string, F extends keyof T = keyof T> {
  indexName?: N;
  pageToken?: string;
  limit?: number;
  projection?: Array<P>;
  filterConditions?: ConditionSet<Pick<T, F>>;
}

// Filter on query may not include key attributes
export interface QueryParams<T, P extends keyof T = keyof T, N extends string = string, I extends keyof T = keyof T>
    extends ScanParams<T, P, N, Exclude<keyof T, I>> {
  keyConditions: ConditionSet<T, I>;
  ascending?: boolean;
}

export interface PutParams<T, B> {
  item: Optional<T, B>;
  conditions?: ConditionSet<T>;
}

export interface DeleteParams<T, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

export interface UpdateParams<T, K extends KeyAttributes<T>, B> {
  key: KeyValue<T, K>;
  attributes: UpdateAttributes<Optional<T, B>>;
  conditions?: ConditionSet<T>;
}

export interface ConditionCheckParams<T, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

// Convenience types
export type ModelItem<Model> = Model extends DynamoModel<infer T> ?
    T :
    never;

export type ModelInputItem<Model> = Model extends DynamoModel<infer T, infer K, infer I, infer B> ?
    Optional<T, B> :
    never;

export type ModelBaseItem<Model> = Model extends DynamoModel<infer T, infer K, infer I, infer B> ?
    B :
    never;

export type ModelKey<Model> = Model extends DynamoModel<infer T, infer K> ?
    Key<T, K> :
    never;

export type ModelKeyValue<Model> = Model extends DynamoModel<infer T, infer K> ?
    KeyValue<T, K> :
    never;

export type ModelIndexName<Model> = Model extends DynamoModel<infer T, infer K, infer I> ?
    keyof I :
    never;

export type ModelIndexKey<Model, N extends ModelIndexName<Model>> =
    Model extends DynamoModel<infer T, infer K, infer I> ?
        Key<T, I[N]> :
        never;

export type ModelIndexKeyValue<Model, N extends ModelIndexName<Model>> =
    Model extends DynamoModel<infer T, infer K, infer I> ?
        KeyValue<T, I[N]> :
        never;

import {buildConditionExpression, buildUpdateExpression, ConditionSet, UpdateAttributes} from 'dynamodb-expressions'
import {
  BatchGetCommand,
  BatchGetCommandInput, BatchWriteCommand,
  BatchWriteCommandInput,
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand, GetCommandInput,
  PutCommand,
  QueryCommand,
  ScanCommand, TransactWriteCommand, TransactWriteCommandInput, UpdateCommand, UpdateCommandInput,
} from '@aws-sdk/lib-dynamodb';
import {TransactionCanceledException} from '@aws-sdk/client-dynamodb';

export interface GetParams<T, K extends KeyAttributes<T>, P extends keyof T> {
  key: KeyValue<T, K>;
  projection?: Array<P>;
}

export interface ScanResult<T, P extends keyof T = keyof T> {
  items: Array<Pick<T, P>>,
  nextPageToken?: string
}

export interface ScanParams<T, N extends string, P extends keyof T = keyof T, F extends keyof T = keyof T> {
  indexName?: N;
  pageToken?: string;
  limit?: number;
  projection?: Array<P>;
  filterConditions?: ConditionSet<Pick<T, F>>;
}

export interface QueryParams<T, N extends string, P extends keyof T, I extends keyof T> extends ScanParams<T, N, P, Exclude<keyof T, I>> {
  keyConditions: ConditionSet<T, I>;
  ascending?: boolean;
}

export interface PutParams<T, A extends keyof T> {
  item: Pick<T, A>;
  conditions?: ConditionSet<T>;
}

export interface DeleteParams<T, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

export interface UpdateParams<T, K extends KeyAttributes<T>, A extends keyof T> {
  key: KeyValue<T, K>;
  attributes: UpdateAttributes<Pick<T, A>>;
  conditions?: ConditionSet<T>;
}

function createGetCommand<T, K extends KeyAttributes<T>, P extends keyof T>(
    model: DynamoDBModel<T>,
    params: GetParams<T, K, P>
): GetCommandInput {
  const {key, projection} = params;
  return {
    TableName: model.tableName,
    Key: key,
    ProjectionExpression: projection?.join(', '),
  };
}

function createScanRequest<T, N extends string, P extends keyof T, F extends keyof T>(
    model: DynamoDBModel<T>,
    params: ScanParams<T, N, P, F>,
) {
  const attributes = {};
  const {indexName, filterConditions, pageToken, limit, projection} = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attributes),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ...attributes,
  };
}

function createQueryRequest<T, N extends string, P extends keyof T, I extends keyof T>(
    model: DynamoDBModel<T>,
    params: QueryParams<T, N, P, I>
) {
  const attributes = {};
  const {indexName, keyConditions, filterConditions, projection, limit, ascending, pageToken} = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    KeyConditionExpression: buildConditionExpression(keyConditions, attributes),
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attributes),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ScanIndexForward: ascending,
    ...attributes,
  };
}

function createPutRequest<T, A extends keyof T>(
    model: DynamoDBModel<T>,
    params: PutParams<T, A>
) {
  const attributes = {};
  const {item, conditions} = params;

  Object.assign(item, model.params.creator?.(item));
  //addTimes(item, true);

  return {
    TableName: model.tableName,
    Item: item,
    ConditionExpression: conditions && buildConditionExpression(conditions, attributes),
    ...attributes,
  };
}

function createUpdateRequest<T, K extends KeyAttributes<T>, A extends keyof T>(
    model: DynamoDBModel<T, K>,
    params: UpdateParams<T, K, A>
) {
  const attr = {};
  const {key, attributes, conditions} = params;
  Object.assign(attributes, model.params.updater?.(attributes));
  //addTimes(attributes, false);

  return {
    TableName: model.tableName,
    Key: key,
    ReturnValues: 'ALL_NEW',
    UpdateExpression: buildUpdateExpression(attributes, attr),
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}

function createDeleteRequest<T, K extends KeyAttributes<T>>(
    model: DynamoDBModel<T, K, any>,
    params: DeleteParams<T, K>
) {
  const attr = {};
  const {key, conditions} = params;

  return {
    TableName: model.tableName,
    Key: key,
    ReturnValues: 'NONE',
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}

// declare interface DynamoDBDocument {
//   get(params: {Key: Record<string, unknown>}): Promise<unknown>;
//   query(params: any): Promise<any>;
// }

//type DynamoDBDocument = any; // TODO aws sdk v2 and v3 support?

abstract class DynamoDbWrapper {
  constructor(readonly dc: DynamoDBDocumentClient) {
  }

  protected async send(command: any): Promise<any> {
    try {
      return await this.dc.send(command);
    } catch (err) {
      throw err;
    }
  }
}

class DynamoDbTransaction extends DynamoDbWrapper {
  private readonly items: NonNullable<TransactWriteCommandInput['TransactItems']> = [];

  // TODO follow batch style with {model, params} or perhaps change batch statements to use execute repeatedly to get remaining items
  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any,B>,
      ...paramsList: Array<PutParams<T, Exclude<keyof T, keyof B>>>
  ): DynamoDbTransaction {
    this.items.push(...paramsList.map(params => ({Put: createPutRequest(model, params)})));

    return this;
  }

  update<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, Exclude<keyof T, keyof B>>>
  ): DynamoDbTransaction {
    this.items.push(...paramsList.map(params => ({Update: createUpdateRequest(model, params)})));

    return this;
  }

  delete<T, K extends KeyAttributes<T>>(
      model: DynamoDBModel<T, K>,
      ...paramsList: Array<DeleteParams<T, K>>
  ): DynamoDbTransaction {
    this.items.push(...paramsList.map(params => ({Delete: createDeleteRequest(model, params)})));

    return this;
  }

  async commit(): Promise<void> {
    await this.send(new TransactWriteCommand({
      TransactItems: this.items
    }));
  }

  static isConditionalCheckFailed(err: any) {
    return err.name === 'TransactionCanceledException' && (err as TransactionCanceledException)
        .CancellationReasons?.some(r => r.Code === 'ConditionalCheckFailed');
  }

}

type BatchItem<T = unknown> = {
  model: DynamoDBModel<T>;
  item: T;
};

class DynamoDbBatchGetStatement extends DynamoDbWrapper {
  private requestMap: NonNullable<BatchGetCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoDBModel<unknown>>();

  get<T, K extends KeyAttributes<T>, P extends keyof T>(
      model: DynamoDBModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoDbBatchGetStatement {
    for (const params of paramsList) {
      const {Keys: keys = []} = this.requestMap[model.tableName] ?? {};
      keys.push(createGetCommand(model, params));
      this.modelMap.set(model.tableName, model);
      this.requestMap[model.tableName] = {Keys: keys};
    }

    return this;
  }

  async execute(): Promise<{items: Array<BatchItem>; done: boolean}> {
    const {Responses: itemMap = {}, UnprocessedKeys: requestMap} = await this.dc.send(new BatchGetCommand({RequestItems: this.requestMap}));
    const items: Array<BatchItem> = [];
    let done = true;

    for (const [tableName, tableItems] of Object.entries(itemMap)) {
      const model = this.modelMap.get(tableName) as DynamoDBModel<unknown>;

      for (const item of tableItems) {
        items.push({model, item});
      }
    }

    if (requestMap) {
      this.requestMap = requestMap;

      done = false;
    }

    return {items, done};
  }
}

// type BatchPutRequest<T, K extends KeyAttributes<T>, B> = {
//   model: DynamoDBModel<T, K, any, B>;
//   params: Pick<PutParams<T, Exclude<keyof T, keyof B>>, 'item'>;
// };
//
// type BatchDeleteRequest<T, K extends KeyAttributes<T>> = {
//   model: DynamoDBModel<T, K>;
//   params: Pick<DeleteParams<T, K>, 'key'>;
// };

class DynamoDbBatchWriteStatement extends DynamoDbWrapper {
  private requestMap: NonNullable<BatchWriteCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoDBModel<unknown>>();

  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, Exclude<keyof T, keyof B>>, 'item'>>
  ): DynamoDbBatchWriteStatement {
    for (const params of paramsList) {
      const requestItems = this.requestMap[model.tableName] ?? [];
      requestItems.push(createPutRequest(model, params));
      this.modelMap.set(model.tableName, model);
      this.requestMap[model.tableName] = requestItems;
    }

    return this;
  }

  delete<T, K extends KeyAttributes<T>>(
      model: DynamoDBModel<T, K>,
      ...paramsList: Array<Pick<DeleteParams<T, K>, 'key'>>
  ): DynamoDbBatchWriteStatement {
    for (const params of paramsList) {
      const requestItems = this.requestMap[model.tableName] ?? [];
      requestItems.push(createDeleteRequest(model, params));
      this.modelMap.set(model.tableName, model);
      this.requestMap[model.tableName] = requestItems;
    }

    return this;
  }

  async execute(): Promise<{done: boolean;}> {
    const {UnprocessedItems: requestMap} = await this.dc.send(new BatchWriteCommand({RequestItems: this.requestMap}));
    let done = true;

    if (requestMap) {
      this.requestMap = requestMap;
      done = false;
    }

    return {done};
  }
}

type KeyAttributes<T> = [keyof T] | [keyof T, keyof T];

type Key<T, K extends KeyAttributes<T>> = K extends [keyof T, keyof T] ? K[1] | K[0] : K[0];
//type Key<T, K extends KeyAttributes<T>> = K extends [keyof T, keyof T] ? Pick<T, K[1] | K[0]> : Pick<T, K[0]>;
type KeyValue<T, K extends KeyAttributes<T>> = Pick<T, Key<T, K>>;

//type KeyIndices<T, N extends string, I extends KeyAttributes<T>> = Record<N, I>;
type KeyIndices<T> = Record<string, KeyAttributes<T>>;

type AttributeType = 'string' | 'number' | 'binary';
type AttributeSchema<T> = Record<string, AttributeType>;

//type BaseItemCreator<T, B> = <U = Omit<T, keyof B>> (item: U) => B;
//type BaseItemCreator<T, B, U = Omit<T, keyof B>> = (item: U) => B;
//type BaseItemCreator<T, B, U> = (item: U) => B;

type ModelParams<T, K extends KeyAttributes<T>, I extends KeyIndices<T>, B> = {
  keyAttributes?: K;
  indices: I;
  creator?: (item: any) => B;
  updater?: (item: any) => Partial<B>;
};

class DynamoDBModelBuilder<T, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}, B = {}> extends DynamoDbWrapper {
  private readonly params: ModelParams<T, K, I, B> = {
    indices: {} as I
  };

  constructor(dc: DynamoDBDocumentClient, readonly name: string, readonly tableName: string) {
    super(dc);
  }

  withKey<_K extends KeyAttributes<T>>(...keyAttributes: _K): DynamoDBModelBuilder<T, _K> {
    const builder = this as unknown as DynamoDBModelBuilder<T, _K>;
    builder.params.keyAttributes = keyAttributes;

    return builder;
  }

  withIndex<N extends string, IK extends KeyAttributes<T>>(name: N, ...indexAttributes: IK): DynamoDBModelBuilder<T, K, I & Record<N, IK>> {
    const builder = this as unknown as DynamoDBModelBuilder<T, K, I & Record<N, IK>>;

    builder.params.indices[name] = indexAttributes as any;

    return builder;
  }

  // withIndex2<_I extends KeyIndices<T>>(name: keyof _I, ...indexAttributes: _I[keyof _I]): DynamoDBModelBuilder<T, K, I & _I> {
  //   const builder = this as unknown as DynamoDBModelBuilder<T, K, I & _I>;
  //
  //   builder.params.indices[name] = indexAttributes as any;
  //
  //   return builder;
  // }

  //withCreator<_B, U = Omit<T, keyof _B>>(creator: (item: U) => _B) {
  withCreator<_B>(creator: (item: any) => _B) {
    const builder = this as unknown as DynamoDBModelBuilder<T & B, K, I, _B>;

    builder.params.creator = creator;

    return builder;
  }

  withUpdater(updater: (item: Omit<T, keyof B>) => Partial<B>) {
    const builder = this;

    builder.params.updater = updater;

    return builder;
  }


  withSchema(schema: AttributeSchema<T>) {
    // Optional but required for model.createTable()
    // TODO
  }

  build(): DynamoDBModel<T, K, I, B> {
    return new DynamoDBModel(this.dc, this.name, this.tableName, this.params);
  }
}

export class DynamoDbClient {
  constructor(readonly dc: DynamoDBDocumentClient) {
  }

  model<T>(name: string, tableName: string = name): DynamoDBModelBuilder<T> {
    return new DynamoDBModelBuilder<T>(this.dc, name, tableName);
  }

  transaction(): DynamoDbTransaction {
    return new DynamoDbTransaction(this.dc);
  }

  batchGet(): DynamoDbBatchGetStatement {
    return new DynamoDbBatchGetStatement(this.dc);
  }

  batchWrite(): DynamoDbBatchWriteStatement {
    return new DynamoDbBatchWriteStatement(this.dc);
  }
}

export type Item = Record<string, any>;

function parsePageToken(pageToken: string | undefined): Item | undefined {
  return pageToken && JSON.parse(Buffer.from(pageToken, 'base64').toString());
}

function formatPageToken(lastKey: Item | undefined) {
  return lastKey && Buffer.from(JSON.stringify(lastKey)).toString('base64');
}

type WriteItem<T, B> = Omit<T, keyof B>;
type ReadItem<T, B> = WriteItem<T, B> & B;

export class DynamoDBModel<T, K extends KeyAttributes<T> = any, I extends KeyIndices<T> = any, B = any> extends DynamoDbWrapper {
  constructor(readonly dc: DynamoDBDocumentClient, readonly name: string, readonly tableName: string, readonly params: ModelParams<T, K, I, B>) {
    super(dc);
  }

  async get<P extends keyof T>(
      params: GetParams<T, K, P>
  ): Promise<T | undefined> {
    const {Item: item} = await this.send(new GetCommand(createGetCommand(this, params)));

    return item as T | undefined;
  }

  async scan<N extends string, P extends keyof T>(
      params: ScanParams<T, N, P> = {}
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.send(new ScanCommand(createScanRequest(this, params)));

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }

  async query<N extends string, P extends keyof T>(
      params: QueryParams<T, N, P, Key<T, N extends keyof I ? I[N] : K>>
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.send(new QueryCommand(createQueryRequest(this, params)));

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }

  async put(
      params: PutParams<T, Exclude<keyof T, keyof B>>
  ): Promise<{item: T}> {
    await this.send(new PutCommand(createPutRequest(this, params)));

    return {
      item: params.item as T
    };
  }

  async update(
      params: UpdateParams<T, K, Exclude<keyof T, keyof B>>
  ): Promise<{item: T}> {
    const {Attributes: item} = await this.send(new UpdateCommand(createUpdateRequest(this, params)));

    return {
      item: item as T
    };
  }

  async delete(
      params: DeleteParams<T, K>
  ): Promise<void> {
    await this.send(new DeleteCommand(createDeleteRequest(this, params)));
  }

}

type Person = {
  id: string;
  name: string;
  email: string;
  age?: number;
};

async function foo() {

  const client = new DynamoDbClient(null as any);
  const model = client.model<Person>('persons')
      .withKey('id', 'email')
      .withIndex('foo-index', 'name', 'age')
      .withIndex('bar-index', 'age')
      .withIndex('foo', 'email')
      .withCreator(x => ({id: x.email.reverse() as string, createdTime: new Date().toJSON(), modifiedTime: new Date().toJSON()}))
      .withUpdater(x => ({modifiedTime: new Date().toJSON()}))
      .build();

  const {done} = await client.batchWrite()
      .put(model, {item: {email:'', name:''}})
      .execute();

  await client.transaction()
      .put(model, {item: {email:'',name:''}})
      .delete(model, {key: {id: '', email: ''}})
      .commit();

  //new DynamoDbBatchGetStatement(null as any).get([{model, params: {key: {id: '', email:''}, projection: ['id']}}])

  const item = await model.get({key: {id: 'a', email: 'foo'}});

  await model.query({indexName: 'foo-index', keyConditions: {name: '', age: 45}})
  await model.query({indexName: 'bar-index', keyConditions: {age: 45}})
  await model.query({keyConditions: {id: 'a'}})

  //const x: PutParams<Person, Exclude<keyof Person, never>> = {item: {name: 'foo', id: 'foo', email: 'foo'}};
  //const x: PutParams<Person, keyof Record<string, never>> = {item: {}};

  await model.put({item: {name: 'FOO', email: 'foo@bar.com', age:45}})
}

class Something<T> {
  constructor(readonly value: T) {
  }
}

type Foo<T, K extends keyof any = keyof any> = {
  [P in Extract<keyof T, K>]?: Something<T[P]>;
} & {
  [P in Exclude<K, keyof T>]?: Something<unknown>;
};



const f1: Foo<Person, string> = {name: new Something('45'), age: new Something(45), foo: new Something(true), id: new Something('44')}
f1[42] = new Something(true);
const l = f1[3]
const f2: Foo<Person, 'name' | 'age'> = {name: new Something('a'), age: new Something(45)}
const f3: Foo<Person, 'foo'> = {foo: new Something(false)}
const f4: Foo<Person, keyof Person> = {name: new Something('false')}

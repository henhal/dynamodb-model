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
  ScanCommand, ServiceOutputTypes, TransactWriteCommand, TransactWriteCommandInput, UpdateCommand, UpdateCommandInput,
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

// Filter on query may not include key attributes
export interface QueryParams<T, N extends string, P extends keyof T, I extends keyof T> extends
    ScanParams<T, N, P, Exclude<keyof T, I>> {
  keyConditions: ConditionSet<T, I>;
  ascending?: boolean;
}

export interface PutParams<T, B> {
  item: WrittenItem<T, B>;
  conditions?: ConditionSet<T>;
}

export interface DeleteParams<T, K extends KeyAttributes<T>> {
  key: KeyValue<T, K>;
  conditions?: ConditionSet<T>;
}

export interface UpdateParams<T, K extends KeyAttributes<T>, B> {
  key: KeyValue<T, K>;
  attributes: UpdateAttributes<WrittenItem<T, B>>;
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
  const attr = {};
  const {indexName, filterConditions, pageToken, limit, projection} = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attr),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ...attr,
  };
}

function createQueryRequest<T, N extends string, P extends keyof T, I extends keyof T>(
    model: DynamoDBModel<T>,
    params: QueryParams<T, N, P, I>
) {
  const attr = {};
  const {indexName, keyConditions, filterConditions, projection, limit, ascending, pageToken} = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    KeyConditionExpression: buildConditionExpression(keyConditions, attr),
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attr),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ScanIndexForward: ascending,
    ...attr,
  };
}

function createPutRequest<T, B>(
    model: DynamoDBModel<T>,
    params: PutParams<T, B>
) {
  const attr = {};
  const {item, conditions} = params;

  const fullItem: T & B = Object.assign(item, ...model.params.creators.map(creator => creator(item)));

  return {
    TableName: model.tableName,
    Item: fullItem,
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}

function createUpdateRequest<T, K extends KeyAttributes<T>, B>(
    model: DynamoDBModel<T, K>,
    params: UpdateParams<T, K, B>
) {
  const attr = {};
  const {key, attributes, conditions} = params;
  Object.assign(attributes, ...model.params.updaters.map(updater => updater(attributes)));

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

type DynamoDbCommand = {input: any};

abstract class DynamoDbWrapper {
  constructor(readonly client: DynamoDbClient) {
  }

  protected log(...args: any[]) {
    console.log(...args);
  }

  protected async command<C extends DynamoDbCommand, O>(cmd: C, f: (dc: DynamoDBDocumentClient, cmd: C) => Promise<O>): Promise<O> {
    const tag = cmd.constructor.name;

    try {
      this.log(`[${tag}] Input:\n${JSON.stringify(cmd.input, null, 2)}`);
      const output = await f(this.client.dc, cmd);
      this.log(`[${tag}] Output:\n${JSON.stringify(output, null, 2)}`);
      return output;
    } catch (err) {
      this.log(`[${tag}] Error: ${err}`);
      throw err;
    }
  }
}

class DynamoDbTransaction extends DynamoDbWrapper {
  private readonly items: NonNullable<TransactWriteCommandInput['TransactItems']> = [];

  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any,B>,
      ...paramsList: Array<PutParams<T, B>>
  ): DynamoDbTransaction {
    this.items.push(...paramsList.map(params => ({Put: createPutRequest(model, params)})));

    return this;
  }

  update<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any, B>,
      ...paramsList: Array<UpdateParams<T, K, B>>
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
    await this.command(new TransactWriteCommand({
      TransactItems: this.items
    }), (dc, cmd) => dc.send(cmd));
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

class DynamoDbBatchStatement extends DynamoDbWrapper {
  get<T, K extends KeyAttributes<T>, P extends keyof T>(
      model: DynamoDBModel<T, K>, ...paramsList: Array<GetParams<T, K, P>>
  ): DynamoDbBatchGetStatement {
    return new DynamoDbBatchGetStatement(this.client).get(model, ...paramsList);
  }

  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
  ): DynamoDbBatchWriteStatement {
    return new DynamoDbBatchWriteStatement(this.client).put(model, ...paramsList);
  }

  delete<T, K extends KeyAttributes<T>>(
      model: DynamoDBModel<T, K>,
      ...paramsList: Array<Pick<DeleteParams<T, K>, 'key'>>
  ): DynamoDbBatchWriteStatement {
    return new DynamoDbBatchWriteStatement(this.client).delete(model, ...paramsList);
  }
}

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
    const {Responses: itemMap = {}, UnprocessedKeys: requestMap} = await this.command(
        new BatchGetCommand({RequestItems: this.requestMap}),
        (dc, cmd) => dc.send(cmd));
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

class DynamoDbBatchWriteStatement extends DynamoDbWrapper {
  private requestMap: NonNullable<BatchWriteCommandInput['RequestItems']> = {};
  private readonly modelMap = new Map<string, DynamoDBModel<unknown>>();

  put<T, K extends KeyAttributes<T>, B>(
      model: DynamoDBModel<T, K, any, B>,
      ...paramsList: Array<Pick<PutParams<T, B>, 'item'>>
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
    const {UnprocessedItems: requestMap} = await this.command(
        new BatchWriteCommand({RequestItems: this.requestMap}),
        (dc, cmd) => dc.send(cmd));
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
type KeyValue<T, K extends KeyAttributes<T>> = Pick<T, Key<T, K>>;

type KeyIndices<T> = Record<string, KeyAttributes<T>>;

type AttributeType = 'string' | 'number' | 'binary';
type AttributeSchema<T> = Record<string, AttributeType>;

type ModelParams<T, K extends KeyAttributes<T>, I extends KeyIndices<T>, B> = {
  keyAttributes?: K;
  indices: I;
  //creator?: (item: any) => B;
  creators: Array<(item: any) => Partial<B>>;
  //updater?: (item: any) => Partial<T>;
  updaters: Array<(attributes: any) => Partial<T>>;
};

class DynamoDBModelBuilder<T, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}, B = {}> extends DynamoDbWrapper {
  private readonly params: ModelParams<T, K, I, B> = {
    indices: {} as I,
    creators: [],
    updaters: []
  };

  constructor(client: DynamoDbClient, readonly name: string, readonly tableName: string) {
    super(client);
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

  // Ideally this would be item: WrittenItem<T, _B> but then _B cannot be inferred from the return type
  withCreator<_B>(creator: (item: T) => _B) {
    const builder = this as unknown as DynamoDBModelBuilder<T & _B, K, I, B & _B>;

    //builder.params.creator = creator;
    builder.params.creators.push(creator);

    return builder;
  }

  withUpdater(updater: (item: Partial<T>) => Partial<T>) {
    const builder = this;

    builder.params.updaters.push(updater);

    return builder;
  }

  build(): DynamoDBModel<T, K, I, B> {
    return new DynamoDBModel(this.client, this.name, this.tableName, this.params);
  }
}

export class DynamoDbClient {
  constructor(readonly dc: DynamoDBDocumentClient) {
  }

  model<T>(name: string, tableName: string = name): DynamoDBModelBuilder<T> {
    return new DynamoDBModelBuilder<T>(this, name, tableName);
  }

  transaction(): DynamoDbTransaction {
    return new DynamoDbTransaction(this);
  }

  batch(): DynamoDbBatchStatement {
    return new DynamoDbBatchStatement(this);
  }
}

export type Item = Record<string, any>;

function parsePageToken(pageToken: string | undefined): Item | undefined {
  return pageToken && JSON.parse(Buffer.from(pageToken, 'base64').toString());
}

function formatPageToken(lastKey: Item | undefined) {
  return lastKey && Buffer.from(JSON.stringify(lastKey)).toString('base64');
}

// An item that can be put or updated.
// Note that B is _allowed_ to be written but could be overwritten by creators/updaters.
type WrittenItem<T, B> = Omit<T, keyof B> & Partial<B>;

export class DynamoDBModel<T, K extends KeyAttributes<T> = any, I extends KeyIndices<T> = any, B = any> extends DynamoDbWrapper {
  constructor(
      client: DynamoDbClient,
      readonly name: string,
      readonly tableName: string,
      readonly params: ModelParams<T, K, I, B>
  ) {
    super(client);
  }

  async get<P extends keyof T>(
      params: GetParams<T, K, P>
  ): Promise<T | undefined> {
    const {Item: item} = await this.command(
        new GetCommand(createGetCommand(this, params)),
        (dc, cmd) => dc.send(cmd));

    return item as T | undefined;
  }

  async scan<N extends string, P extends keyof T>(
      params: ScanParams<T, N, P> = {}
  ): Promise<ScanResult<T, P>> {
    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.command(
        new ScanCommand(createScanRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }

  async query<N extends string, P extends keyof T>(
      params: QueryParams<T, N, P, Key<T, N extends keyof I ? I[N] : K>>
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

    return {
      item: params.item as T
    };
  }

  async update(
      params: UpdateParams<T, K, B>
  ): Promise<{item: T}> {
    const {Attributes: item} = await this.command(
        new UpdateCommand(createUpdateRequest(this, params)),
        (dc, cmd) => dc.send(cmd));

    return {
      item: item as T
    };
  }

  async delete(
      params: DeleteParams<T, K>
  ): Promise<void> {
    await this.command(
        new DeleteCommand(createDeleteRequest(this, params)),
        (dc, cmd) => dc.send(cmd));
  }
}

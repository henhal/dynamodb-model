import {buildConditionExpression, ConditionSet} from 'dynamodb-expressions'

declare interface DynamoDBDocument {
  get(params: {Key: Record<string, unknown>}): Promise<unknown>;
  query(params: any): Promise<any>;
}

//type DynamoDBDocument = any; // TODO aws sdk v2 and v3 support?

abstract class DynamoDbWrapper {
  constructor(readonly dc: DynamoDBDocument) {
  }
}

class DynamoDbTransaction extends DynamoDbWrapper {
  update() {
    return this;
  }

  async commit(): Promise<void> {
  }
}

class DynamoDbBatchGetStatement extends DynamoDbWrapper {
}

class DynamoDbBatchWriteStatement extends DynamoDbWrapper {
}

type KeyAttributes<T> = [keyof T] | [keyof T, keyof T];

type Key<T, K extends KeyAttributes<T>> = K extends [keyof T, keyof T] ? K[1] | K[0] : K[0];
//type Key<T, K extends KeyAttributes<T>> = K extends [keyof T, keyof T] ? Pick<T, K[1] | K[0]> : Pick<T, K[0]>;
type KeyValue<T, K extends KeyAttributes<T>> = Pick<T, Key<T, K>>;

//type KeyIndices<T, N extends string, I extends KeyAttributes<T>> = Record<N, I>;
type KeyIndices<T> = Record<string, KeyAttributes<T>>;

type AttributeType = 'string' | 'number' | 'binary';
type AttributeSchema<T> = Record<string, AttributeType>;

type ModelParams<T, K extends KeyAttributes<T>, I extends KeyIndices<T>> = {
  keyAttributes?: K;
  indices: I
};

class DynamoDBModelBuilder<T, K extends KeyAttributes<T> = never, I extends KeyIndices<T> = {}> extends DynamoDbWrapper {
  private readonly params: ModelParams<T, K, I> = {
    indices: {} as I
  };

  constructor(dc: DynamoDBDocument, readonly tableName: string) {
    super(dc);
  }

  withKey<_K extends KeyAttributes<T>>(...keyAttributes: _K): DynamoDBModelBuilder<T, _K> {
    const builder = this as unknown as DynamoDBModelBuilder<T, _K>;
    builder.params.keyAttributes = keyAttributes;

    return builder;
  }

  withIndex<N extends string, _I extends KeyAttributes<T>>(name: N, ...indexAttributes: _I): DynamoDBModelBuilder<T,  K, I & Record<N, _I>> {
    const builder = this as unknown as DynamoDBModelBuilder<T, K, I & Record<N, _I>>;

    builder.params.indices[name] = indexAttributes as any;

    return builder;
  }

  withSchema(schema: AttributeSchema<T>) {
    // Optional but required for model.createTable()
    // TODO
  }

  build(): DynamoDBModel<T, K, I> {
    return new DynamoDBModel<T, K, I>(this.dc, this.tableName, this.params);
  }
}

export class DynamoDbClient {
  constructor(readonly dc: DynamoDBDocument) {
  }

  model<T>(tableName: string): DynamoDBModelBuilder<T> {
    return new DynamoDBModelBuilder<T>(this.dc, tableName);
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

export interface ScanParams<T, N extends string, P extends keyof T = keyof T, F extends keyof T = keyof T> {
  indexName?: N;
  pageToken?: string;
  limit?: number;
  projection?: Array<P>;
  filterConditions?: ConditionSet<Pick<T, F>>;
}

export interface QueryParams<T, N extends string, P extends keyof T, I extends keyof T> extends ScanParams<T, N, P, Exclude<keyof T, I>> {
  keyConditions: ConditionSet<Pick<T, I>>;
  ascending?: boolean;
}

export type Item = Record<string, any>;

function parsePageToken(pageToken: string | undefined): Item | undefined {
  return pageToken && JSON.parse(Buffer.from(pageToken, 'base64').toString());
}

function formatPageToken(lastKey: Item | undefined) {
  return lastKey && Buffer.from(JSON.stringify(lastKey)).toString('base64');
}

class DynamoDBModel<T, K extends KeyAttributes<T>, I extends KeyIndices<T>> extends DynamoDbWrapper {
  constructor(readonly dc: DynamoDBDocument, readonly tableName: string, private readonly params: ModelParams<T, K, I>) {
    super(dc);
  }

  async get(key: KeyValue<T, K>): Promise<T | undefined> {
    return await this.dc.get({Key: key}) as T | undefined;
  }

  // async query<N extends keyof I>(indexName: keyof I, keyConditions: ConditionSet<KeyValue<T, I[N]>>) {
  //
  // }
  async query<N extends keyof I & string, P extends keyof T>(params: QueryParams<T, N, P, Key<T, I[N]>>) {
    const attributes = {};
    const {indexName, keyConditions, filterConditions, projection, limit, ascending, pageToken} = params;

    const {Items: items = [], LastEvaluatedKey: lastKey} = await this.dc.query({
      TableName: this.tableName,
      IndexName: indexName,
      KeyConditionExpression: buildConditionExpression(keyConditions, attributes),
      FilterExpression: filterConditions && buildConditionExpression(filterConditions, attributes),
      ExclusiveStartKey: parsePageToken(pageToken),
      Limit: limit,
      ProjectionExpression: projection?.join(', '),
      ScanIndexForward: ascending,
      ...attributes,
    });

    return {
      items: items as Array<Pick<T, P>>,
      nextPageToken: formatPageToken(lastKey),
    };
  }
}

type Person = {
  id: string;
  name: string;
  email: string;
  age?: number;
};

async function foo() {
  const model = new DynamoDbClient(null as any).model<Person>('persons')
      .withKey('id', 'email')
      .withIndex('foo-index', 'name', 'age')
      .withIndex('bar-index', 'age')
      .build();

  await model.get({id: 'a', email: 'foo'})

  await model.query({indexName: 'bar-index', keyConditions: {age: 45}})
}

import {ConditionCheck} from '@aws-sdk/client-dynamodb';
import {
  DeleteCommandInput,
  GetCommandInput,
  PutCommandInput,
  QueryCommandInput,
  ScanCommandInput,
  UpdateCommandInput
} from '@aws-sdk/lib-dynamodb';
import {buildConditionExpression, buildUpdateExpression} from 'dynamodb-expressions';
import {DynamoModel} from './DynamoModel';
import {DynamoWrapper} from './DynamoWrapper';
import {
  ConditionCheckParams,
  DeleteParams,
  Extend,
  GetParams,
  Item,
  KeyAttributes,
  ProjectionKeys,
  PutParams,
  QueryParams,
  ScanParams,
  UpdateParams,
} from './types';
import {parsePageToken} from './utils';

export function getReturnedConsumedCapacity({client}: DynamoWrapper) {
  return client.options.enableTableMetrics ? 'INDEXES' : 'NONE';
}

export function createGetRequest<T extends Item, K extends KeyAttributes<T>, P extends ProjectionKeys<T2>, T2 extends T = T>(
    model: DynamoModel<T>,
    params: GetParams<T2, K, P>
): GetCommandInput {
  const {key, projection, consistency} = params;
  return {
    TableName: model.tableName,
    Key: key,
    ProjectionExpression: projection?.join(', '),
    ConsistentRead: consistency === 'strong',
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
  };
}

export function createScanRequest<T extends Item, P extends ProjectionKeys<T2>, N extends string, F extends ProjectionKeys<T2>, T2 extends T = T>(
    model: DynamoModel<T>,
    params: ScanParams<T2, P, N, F>,
): ScanCommandInput {
  const attr = {};
  const {
    indexName,
    filterConditions,
    pageToken,
    limit,
    projection,
    consistency
  } = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attr),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ConsistentRead: consistency === 'strong',
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
    ...attr,
  };
}

export function createQueryRequest<T extends Item, P extends ProjectionKeys<T2>, N extends string, I extends keyof T, T2 extends T = T>(
    model: DynamoModel<T>,
    params: QueryParams<T2, P, N, I>
): QueryCommandInput {
  const attr = {};
  const {
    indexName,
    keyConditions,
    filterConditions,
    projection,
    limit,
    ascending,
    pageToken,
    consistency
  } = params;

  return {
    TableName: model.tableName,
    IndexName: indexName,
    KeyConditionExpression: buildConditionExpression(keyConditions, attr),
    FilterExpression: filterConditions && buildConditionExpression(filterConditions, attr),
    ExclusiveStartKey: parsePageToken(pageToken),
    Limit: limit,
    ProjectionExpression: projection?.join(', '),
    ScanIndexForward: ascending,
    ConsistentRead: consistency === 'strong',
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
    ...attr,
  };
}

export function createPutRequest<T extends Item, B extends Item, T2 extends T = T>(
    model: DynamoModel<T>,
    params: PutParams<T2, B>
): PutCommandInput {
  const attr = {};
  const {item, conditions} = params;

  const fullItem: Extend<T, B> = Object.assign(item, ...model.params.creators.map(creator => creator(item)));

  return {
    TableName: model.tableName,
    Item: fullItem,
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
    ...attr,
  };
}

export function createUpdateRequest<T extends Item, K extends KeyAttributes<T>, B extends Item, T2 extends T = T>(
    model: DynamoModel<T, K>,
    params: UpdateParams<T2, K, B>
): UpdateCommandInput & {UpdateExpression: string | undefined;} {
  // Type mismatch with DynamoDB lib - update items within transactions require UpdateExpression to be present even if
  // it's undefined, it must not be absent
  const attr = {};
  const {key, attributes, conditions} = params;
  Object.assign(attributes, ...model.params.updaters.map(updater => updater(attributes)));

  return {
    TableName: model.tableName,
    Key: key,
    ReturnValues: 'ALL_NEW',
    UpdateExpression: buildUpdateExpression(attributes, attr),
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
    ...attr,
  };
}

export function createDeleteRequest<T extends Item, K extends KeyAttributes<T>>(
    model: DynamoModel<T, K, any>,
    params: DeleteParams<T, K>
): DeleteCommandInput {
  const attr = {};
  const {key, conditions} = params;

  return {
    TableName: model.tableName,
    Key: key,
    ReturnValues: 'ALL_OLD',
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ReturnConsumedCapacity: getReturnedConsumedCapacity(model),
    ...attr,
  };
}

export function createConditionCheckRequest<T extends Item, K extends KeyAttributes<T>>(
    model: DynamoModel<T, K>,
    params: ConditionCheckParams<T, K>
): ConditionCheck {
  const attr = {};
  const {key, conditions} = params;

  return {
    TableName: model.tableName,
    Key: key,
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}
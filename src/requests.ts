import {
  ConditionCheckParams,
  DeleteParams,
  GetParams,
  KeyAttributes, PutParams,
  QueryParams,
  ScanParams,
  UpdateParams,
} from './types';
import {GetCommandInput} from '@aws-sdk/lib-dynamodb';
import {buildConditionExpression, buildUpdateExpression} from 'dynamodb-expressions';
import {DynamoModel} from './DynamoModel';
import {parsePageToken} from './utils';

export function createGetRequest<T, K extends KeyAttributes<T>, P extends keyof T>(
    model: DynamoModel<T>,
    params: GetParams<T, K, P>
): GetCommandInput {
  const {key, projection} = params;
  return {
    TableName: model.tableName,
    Key: key,
    ProjectionExpression: projection?.join(', '),
  };
}

export function createScanRequest<T, P extends keyof T, N extends string, F extends keyof T>(
    model: DynamoModel<T>,
    params: ScanParams<T, P, N, F>,
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

export function createQueryRequest<T, P extends keyof T, N extends string, I extends keyof T>(
    model: DynamoModel<T>,
    params: QueryParams<T, P, N, I>
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

export function createPutRequest<T, B>(
    model: DynamoModel<T>,
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

export function createUpdateRequest<T, K extends KeyAttributes<T>, B>(
    model: DynamoModel<T, K>,
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

export function createDeleteRequest<T, K extends KeyAttributes<T>>(
    model: DynamoModel<T, K, any>,
    params: DeleteParams<T, K>
) {
  const attr = {};
  const {key, conditions} = params;

  return {
    TableName: model.tableName,
    Key: key,
    ReturnValues: 'ALL_OLD',
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}

export function createConditionCheckRequest<T, K extends KeyAttributes<T>>(
    model: DynamoModel<T, K>,
    params: ConditionCheckParams<T, K>
) {
  const attr = {};
  const {key, conditions} = params;

  return {
    TableName: model.tableName,
    Key: key,
    ConditionExpression: conditions && buildConditionExpression(conditions, attr),
    ...attr,
  };
}
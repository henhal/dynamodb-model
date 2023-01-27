import {Item, TriggerCommand} from './types';

export type StringKeyOf<T> = keyof T & string;

export function parsePageToken(pageToken: string | undefined): Item | undefined {
  return pageToken && JSON.parse(Buffer.from(pageToken, 'base64').toString());
}

export function formatPageToken(lastKey: Item | undefined) {
  return lastKey && Buffer.from(JSON.stringify(lastKey)).toString('base64');
}

export function parseRequest(request: any): {command: TriggerCommand; key: Record<string, any>; tableName?: string;} {
  let req = request.PutRequest ?? request.Put;

  if (req) {
    return {
      command: 'put',
      key: req.Item,
      tableName: req.TableName
    };
  }

  req = request.DeleteRequest ?? request.Delete;

  if (req) {
    return {
      command: 'delete',
      key: req.Key,
      tableName: req.TableName
    };
  }

  req = request.UpdateRequest ?? request.Update;

  if (req) {
    return {
      command: 'update',
      key: req.Key,
      tableName: req.TableName
    };
  }

  throw new Error('Invalid request');
}

export function getKeyValues(item: any, keyAttributes: string[]) {
  return keyAttributes.map(attr => item[attr]);
}

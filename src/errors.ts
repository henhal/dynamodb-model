import {
  ConditionalCheckFailedException,
  DuplicateItemException,
  DynamoDBServiceException,
  ItemCollectionSizeLimitExceededException,
  ProvisionedThroughputExceededException,
  RequestLimitExceeded,
  ResourceNotFoundException,
  TransactionConflictException
} from '@aws-sdk/client-dynamodb';

type DynamoErrors = {
  AccessDenied: DynamoDBServiceException;
  ConditionalCheckFailed: ConditionalCheckFailedException;
  DuplicateItem: DuplicateItemException;
  ItemCollectionSizeLimitExceeded: ItemCollectionSizeLimitExceededException;
  ProvisionedThroughputExceeded: ProvisionedThroughputExceededException;
  RequestLimitExceeded: RequestLimitExceeded;
  ResourceNotFound: ResourceNotFoundException;
  ThrottlingError: DynamoDBServiceException;
  TransactionConflict: TransactionConflictException;
  ValidationError: DynamoDBServiceException;
};

const DynamoErrorNames: { [P in keyof DynamoErrors]: DynamoErrors[P]['name'] } = {
  AccessDenied: 'AccessDeniedException',
  ConditionalCheckFailed: 'ConditionalCheckFailedException',
  DuplicateItem: 'DuplicateItemException',
  ItemCollectionSizeLimitExceeded: 'ItemCollectionSizeLimitExceededException',
  ProvisionedThroughputExceeded: 'ProvisionedThroughputExceededException',
  RequestLimitExceeded: 'RequestLimitExceeded',
  ResourceNotFound: 'ResourceNotFoundException',
  ThrottlingError: 'ThrottlingException',
  TransactionConflict: 'TransactionConflictException',
  ValidationError: 'ValidationException'
};

/**
 * Check if err is a DynamoDB service error of the given name
 */
export function isDynamoError<K extends keyof DynamoErrors>(err: any, name: K): err is DynamoErrors[K] {
  return err instanceof DynamoDBServiceException && err.name === DynamoErrorNames[name];
}

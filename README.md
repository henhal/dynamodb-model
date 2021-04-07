# dynamodb-ts-model
A DynamoDB model implementation with full TypeScript type support.

This module allows you to create fully type-safe DynamoDB models describing your data,
including keys, indices etc. It also supports

* Clean type-safe interface for all table operations, transactions and batch operations
* Auto-generated properties when adding or updating items, useful for timestamps, random IDs etc
* Triggers: register callback functions for modifications to a model

## Installation

`$ npm install dynamodb-ts-model`

## Usage

### Build a model with key, indices, auto-created attributes and triggers.

```
import DynamoClient from 'dynamodb-ts-model';

type Person = {
  id: string;
  name: string;
  email?: string;
  age?: number;
};

const client = new DynamoClient();

const now = () => new Date().toJSON();
 

const persons = client.model<Person>('persons')
  .withKey('id')
  .withIndex('name-age-index', 'name', 'age')
  .withCreator(x => ({id: uuid.v4(), createdTime: now(), modifiedTime: now()}))
  .withUpdater(x => ({modifiedTime: now()}))
  .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}))
  .build();
```

### Querying for items

Conditions and update expressions use the `dynamodb-expressions` module.

```
const {items} = await persons.query({
  indexName: 'name-age-index', 
  keyConditions: {name: 'Henrik', age: Condition.ge(18)}
});
```

### Transactions

```
await client.transaction()
  .put(persons, {item: {name: 'John Doe'}}, {item: {name: 'Jane Doe'}})
  .delete(persons, {key: {id: 'foo'}})
  .commit()
```


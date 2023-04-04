# dynamodb-ts-model
A DynamoDB model implementation with full TypeScript type support.

***
### BREAKING CHANGE in v2:

v2 of this module does not contain any breaking changes, however it does include v3 of [dynamodb-expressions](https://www.npmjs.com/package/dynamodb-expressions)
as a dependency, which is not fully backwards compatible since it changes the signature of two functions. 

***

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
  .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
  .build();
```

You can also dynamically define a model class and defer runtime parameters to the constructor of this class,
which is also very convenient since it creates an easy type to refer to:

```
class PersonModel extends DynamoModel.builder<Person>()
    .withKey('id')
    .withIndex('name-age-index', 'name', 'age')
    .withCreator(x => ({id: uuid.v4(), createdTime: now(), modifiedTime: now()}))
    .withUpdater(x => ({modifiedTime: now()}))
    .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
  .class() {}

const persons = new PersonModel(client, 'persons');

async function doSomething(model: PersonModel) {
  const person = await model.get({key: {id: '42'}});
}
```


### Querying for items

Conditions and update expressions use the `dynamodb-expressions` module.

```
const {items} = await persons.query({
  indexName: 'name-age-index', 
  keyConditions: {name: 'Henrik', age: Condition.ge(18)}
});
```

There is also built-in `AsyncIterator` support to enable simple iteration of scanned or 
queried items without bothering with `nextPageToken`, using `for await ... of` syntax.

Iterate through all persons:
```
for await (const item of persons.scanIterator()) {
  console.log(item.name, item.age);
}
```

Iterate through all persons named Alice over the age of 25:
```
for await (const item of persons.queryIterator({
  indexName: 'name-age-index',
  keyConditions: {
    name: 'Alice',
    age: Condition.ge(25)
  }
})) {
  console.log(item.name, item.age);
}
```

### Transactions

```
await client.transaction()
  .put(persons, {item: {name: 'John Doe'}}, {item: {name: 'Jane Doe'}})
  .delete(persons, {key: {id: 'foo'}})
  .commit()
```


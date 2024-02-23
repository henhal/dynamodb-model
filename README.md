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
  version: string;
  data?: Record<string, string>;
};

const now = () => new Date().toJSON();
const random = () => crypto.randomBytes(32).toString('hex'); 

// Create a model for the persons table, with a single HASH key 'id' and
// an index on 'name' and 'age'.
// Created items get an auto-generated 'id', 'version', 'createdTime' and 'modifiedTime'.
// Updated items get a new 'version' and 'modifiedTime'
// All operations trigger a log function for debugging.
class PersonModel extends DynamoClient.model<Person>()
    .withKey('id')
    .withIndex('name-age-index', 'name', 'age')
    .withCreator(x => ({
      id: random(),
      version: random(),
      createdTime: now(),
      modifiedTime: now()
    }))
    .withUpdater(x => ({
      version: random(),
      modifiedTime: now()
    }))
    .withTrigger((item, command, model) => {
      console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`);
    })
    .class() {}
    
const client = new DynamoClient();   
const persons = new PersonModel(client, 'persons');

async function doSomething(model: PersonModel) {
  const person = await model.get({
    key: {id: '42'}
  });
}    
```

You can also create an "anonymous" model instance without defining a class type:

```
const client = new DynamoClient();   

const persons = client.model<Person>('persons')
  .withKey('id')
  .withIndex('name-age-index', 'name', 'age')
  .withCreator(x => ({id: uuid.v4(), createdTime: now(), modifiedTime: now(), version: random()}))
  .withUpdater(x => ({modifiedTime: now(), version: random()}))
  .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
  .build();
```

This creates a persons model object, but does not create any convenient type for the model, so it's not recommended.


### Querying for items

Conditions and update expressions use the  [dynamodb-expressions](https://www.npmjs.com/package/dynamodb-expressions) module,
enabling an easy syntax for most common operations while still offering support for complex operations.

```
// List all persons with name Alice and age >= 18
const {items} = await persons.query({
  indexName: 'name-age-index', 
  keyConditions: {
    name: 'Alice', 
    age: Condition.ge(18)
  }
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

Iterate through all persons named Bob between the ages of 25 and 35:
```
for await (const item of persons.queryIterator({
  indexName: 'name-age-index',
  keyConditions: {
    name: 'Bob',
    age: Condition.between(25, 35)
  }
})) {
  console.log(item.name, item.age);
}
```

### Updating items

Building update expressions is easy using `dynamodb-expressions`:

```
await persons.update({
  key: {id: '42'},
  attributes: {
    name: 'NewName',
    age: 25
  }
});
```

More advanced updates:

```
await persons.update({
  key: {id: '42'},
  attributes: {
    // Add 2 to the numeric attribute 'age'
    age: UpdateAction.add(2), 
    
    // Remove the attribute 'email'
    email: UpdateAction.remove(),
    
    // Set the attribute 'name' to 'Default name' only if it does not currently exist
    name: UpdateAction.set(SetValue.ifNotExists('name', 'Default Name'))
  }
});
```

Conditional updates:

```
await persons.update({
  key: {id: '42'},
  attributes: {
    email: 'someone@somewhere.com' 
  },
  conditions: {
    // Only perform this update if age is >= 18
    age: Condition.ge(18)
  }
});
```

### Transactions

This library offers an easy way to build transactions from multiple operations:

```
await client.transaction()
  .put(persons, {item: {name: 'John Doe'}}, {item: {name: 'Jane Doe'}})
  .delete(persons, {key: {id: 'foo'}})
  .commit()
```

### Error handling

DynamoDB has several errors of specific interest, such as `ConditionalCheckFailed` thrown when a 
condition is not met - clients commonly need to catch this error to determine if a conditional request
failed at least one condition, and as such it's not really an abnormal error.
A utility method `isDynamoError(err, name)` is available with typings for the most common errors:

```
try {
  await persons.update({
    key: {id: '42'},
    attributes: {
      foo: 'bar' 
    },
    conditions: {
      // Only perform this update if age is >= 18
      age: Condition.ge(18)
    }
  });
} catch (err) {
  if (isDynamoError(err, 'ConditionalCheckFailed')) {
    // Update was not performed due to condition(s) not being met
  } else {
    // Some other abnormal error
    throw err;
  }
}
```

### Atomic update helpers

DynamoDB's conditions enable building "atomic" update operations more advanced than the built-in atomic incrementing of numeric values etc, 
preventing concurrent overwrites.
This is done in the form of a get-modify-update sequence carried out with conditions making sure the updated item
hasn't been changed since it was retrieved. This also enables updating attributes as functions of other attributes.

To use this, an attribute which is unique after each update is required. In the below example, the automatically
updated `modifiedTime` attribute is used (but note that it only offers millisecond precision). Other options include
an attribute set to a random value, an auto-incremented counter etc.

```
async function updatePersonDataAtomic(id: string, data: Record<string, string | number>) {
  await persons.atomicAction({
    key: {id},
    conditionAttribute: 'version'
  }, async ({key, item, conditions}) => item && persons.update({
    key,
    attributes: {
      data: {...item.data, ...data}
    },
    conditions
  }));
}

// Perform two updates of the person with id 42, which if she exists sets data.foo = 42 and data.bar = 43, respectively, without
// overwriting any other attributes within data, and making sure the 'data' object itself exists:
await Promise.all([
  updatePersonDataAtomic('42', {foo: 'hello'}),
  updatePersonDataAtomic('42', {bar: 'world'})
]);
```

What happens here under the hood is that each atomic action will retrieve the item with id 42, 
then perform the given function which updates the item only if `version` hasn't changed from when it was retrieved, 
catching conditional check failed errors and entering a random delay retry mechanism if `version` had indeed changed.
Since two updates are being done concurrently, it's likely that at least one of them will fail at least once and enter the retry scheme:
* The first action will attempt to set data to `{foo: 42}` with `version` === `<version1>`.
* The second action will attempt to set data to `{bar: 43}` with `version` === `<version1>`.
* One of these will succeed, setting `data` and changing `version` to `<version2>`.
* The other one will fail, delay for a few ms, then fetch the item again which now has `version` === `<version2>` and `data` 
  containing the other action's updates, then it will merge `data` with its own updates, and successfully update the item, setting `version` to `<version3>`.

Note that this example of course is a bit silly, it's possible to natively update `data.foo` and `data.bar` separately, 
however handling the case where `data` is undefined is not supported in a single update operation.
More advanced atomic updates may include concurrently modifying array elements etc. 

### Working with union types

Since data modelled in DynamoDB frequently combines different kind of data in the same table, it's quite common to
have data expressed as unions:

```
interface Base {
  createdAt: string;
  updatedAt: string;
}

interface Foo extends Base {
  type: 'foo'; // discriminator field
  id: string;
  name: string;
}

interface Bar extends Base {
  type: 'bar'; // discriminator field
  id: string;
  something: number;
}

type FooBar = Foo | Bar;

class FooBarModel extends DynamoClient.model<FooBar>()
  .withKey('type', 'id') // composite key - silly example since the hash key is poorly chosen :)
  .withCreator(item => ({createdAt: now(), updatedAt: now()}))
  .withUpdater(item => Object.assign(item, {updatedAt: now()}))
  .class() {}
  
const model = new FooBarModel(...);
```

Now, if querying for data which is narrowed to one of the types, it's possible to add a `type` property which 
changes the type of the returned data from `Foo | Bar` to `Bar`.
This is done using the `as<Type>()` function, which is simply a wrapper for a dummy token used to represent the type. 
  
```
const { items } = await model.query({
  type: as<Bar>(),
  keyConditions: {
    type: 'bar'
  }
});

return items.map(item => item.something); // item is of type Bar
```

### Table metrics

Each operation on a table stores the consumed capacity of that operation (read and write) in the DynamoClient instance,
so that it's easy to get metrics for each table.

```
const client = new DynamoClient();
const persons = new PersonModel(client, 'persons');
const products = new ProductModel(client, 'products');

await persons.get(...)
await persons.update(...)
await persons.put(...)
await products.update(...)
await products.put(...)
await persons.put(...)
await client.batch().put(..., ...)

const metrics = client.getTableMetrics();
// returns e.g. persons => {rcu: 20, wcu: 50}, products => {rcu: 4, wcu: 10}
```

To clear the metrics, use `client.clearTableMetrics()`.
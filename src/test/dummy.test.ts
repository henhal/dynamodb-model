import {randomBytes} from 'crypto';
import {Condition, SetValue, UpdateAction} from 'dynamodb-expressions';

import DynamoClient, {isDynamoError} from '../';

type Person = {
  id: string;
  name: string;
  email?: string;
  age?: number;
  data?: Record<string, string>;
};

const now = () => new Date().toJSON();
const random = () => randomBytes(32).toString('hex');

describe('Models', () => {
  it('should create model class', async () => {
    const client = new DynamoClient();

    class PersonModel extends DynamoClient.model<Person>()
        .withKey('id')
        .withIndex('name-age-index', 'name', 'age')
        .withCreator(x => ({
          id: random(),
          createdTime: now(),
          modifiedTime: now(),
          version: random()
        }))
        .withUpdater(x => ({
          modifiedTime: now(),
          version: random()
        }))
        .withTrigger((item, command, model) => {
          console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`);
        })
        .class() {}

    const persons = new PersonModel({client, name: 'persons'});

    // await persons.update({
    //   key: {id: '42'},
    //   attributes: {
    //     age: UpdateAction.add(2),
    //     email: UpdateAction.remove(),
    //     name: UpdateAction.set(SetValue.ifNotExists('name', 'Default Name'))
    //   },
    //   conditions: {
    //     age: Condition.ge(18)
    //   }
    // });
    //
    // await persons.put({
    //   item: {
    //     id: '42',
    //     name: 'Alice'
    //   }
    // });
    //
    // async function updatePersonDataAtomic(id: string, data: Record<string, string>) {
    //   await persons.atomicAction({
    //     key: {id},
    //     conditionAttribute: 'version'
    //   }, async ({key, item, conditions}) => item && persons.update({
    //     key,
    //     attributes: {
    //       data: {...item.data, ...data}
    //     },
    //     conditions
    //   }));
    // }
    //
    // await Promise.all([
    //   updatePersonDataAtomic('42', {foo: 'hello'}),
    //   updatePersonDataAtomic('42', {bar: 'world'})
    // ]);
  });

  it('should identify errors', async () => {
    const client = new DynamoClient(undefined, {logger: {debug: console.log}});

    class PersonModel extends DynamoClient.model<Person>()
        .withKey('id')
        .withIndex('name-age-index', 'name', 'age')
        .withCreator(x => ({
          id: randomBytes(16).toString('hex'),
          createdTime: now(),
          modifiedTime: now()
        }))
        .withUpdater(x => ({
            createdTime: UpdateAction.set(SetValue.ifNotExists('createdTime', now())),
            modifiedTime: now()
        }))
        .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
        .class() {}

    const persons = new PersonModel({client, name: 'persons'});
    await persons.update({key: {id: '42'}, attributes: {age: 40}}).catch(err => null);
    const error = await persons.get({key: {id: '42'}}).catch(err => err);
    expect(error).toBeInstanceOf(Error);
    expect(isDynamoError(error, 'RequestLimitExceeded')).toBeFalsy();
    expect(isDynamoError(error, 'ResourceNotFound')).toBeTruthy();
  })
});

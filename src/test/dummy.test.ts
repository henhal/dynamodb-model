describe('TODO', () => {
  it('Dummy', () => {
    expect(42).toEqual(42);
  });
});

import DynamoClient from '../';

type Person = {
  id: string;
  name: string;
  email?: string;
  age?: number;
};

const client = new DynamoClient();

const now = () => new Date().toJSON();
const uuid = {v4: () => '42'};

class PersonModel extends DynamoClient.model<Person>()
    .withKey('id')
    .withIndex('name-age-index', 'name', 'age')
    .withCreator(x => ({id: uuid.v4(), createdTime: now(), modifiedTime: now()}))
    .withUpdater(x => ({modifiedTime: now()}))
    .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
  .class() {}

const persons = new PersonModel({client, name: 'persons'});

async function doSomething(model: PersonModel) {
  const person = await model.get({
    key: {id: '42'}
  });
}
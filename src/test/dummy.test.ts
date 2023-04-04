import {randomBytes} from 'crypto';

import DynamoClient from '../';

type Person = {
  id: string;
  name: string;
  email?: string;
  age?: number;
};

const now = () => new Date().toJSON();

describe('Models', () => {
  it('should create model class', () => {
    const client = new DynamoClient();

    class PersonModel extends DynamoClient.model<Person>()
        .withKey('id')
        .withIndex('name-age-index', 'name', 'age')
        .withCreator(x => ({
          id: randomBytes(16).toString('hex'),
          createdTime: now(),
          modifiedTime: now()
        }))
        .withUpdater(x => ({modifiedTime: now()}))
        .withTrigger((item, command, model) => console.log(`Trigger: ${model.name}.${command}: ${JSON.stringify(item)}`))
        .class() {}

    const persons = new PersonModel({client, name: 'persons'});
  });
});

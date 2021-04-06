type Couple<T> = [T, T];

type Key<T> = keyof T & string | Couple<keyof T & string>;

type KeyValue<T, K extends Key<T>> = K extends Couple<keyof T> ?
    [T[K[0]], T[K[1]]] :
    K extends keyof T ?
        T[K] :
        never;

type Operator<T> = T; // TODO

type KeyCondition<T, K extends Key<T>> = K extends Couple<keyof T> ?
    [ T[K[0]] ] | [ T[K[0]], Operator<T[K[1]]>] :
    K extends keyof T ?
        T[K] :
        never;

type Diff<T, U> = Omit<T, keyof U>;

type ItemGenerator<T, G> = <U = Diff<T, G>> (item: Readonly<U>) => G;
type ItemUpdater<T, G, U extends Partial<T & G>> = (item: Readonly<Partial<T>>) => U;

class ModelBuilder<T, K extends Key<T> = never, I extends Key<T> = never, G = {}> {
  private _key: K | undefined;
  private _indices: Array<{attributes: I, name: string}> = [];
  private _generators: Array<ItemGenerator<T, any>> = [];
  private _updaters: Array<ItemUpdater<T, G, any>> = [];

  constructor(private readonly tableName: string) {}

  key<K2 extends Key<T>>(key: K2): ModelBuilder<T, K2, I, G> {
    const builder = this as unknown as ModelBuilder<T, K2, I, G>;
    builder._key = key;

    return builder;
  }

  index<I2 extends Key<T>>(attributes: I2, name: string): ModelBuilder<T, K, I | I2, G> {
    const builder = this as ModelBuilder<T, K, I | I2, G>;
    builder._indices.push({attributes, name});

    return builder;
  }

  generator<G2>(generator: ItemGenerator<T, G2>): ModelBuilder<T, K, I, G & G2> {
    const builder = this as unknown as ModelBuilder<T, K, I, G & G2>;
    builder._generators.push(generator);

    return builder;
  }

  updater<U extends Partial<T & G>>(updater: ItemUpdater<T, G, U>): ModelBuilder<T, K, I, G> {
    const builder = this;
    builder._updaters.push(updater);

    return builder;
  }

  build(): Model<T, K, I, G> {
    if (!this._key) {
      throw new Error(`Cannot build model without specified key`);
    }
    return new Model<T, K, I, G>(this.tableName, this._key, this._indices, this._generators, this._updaters);
  }
}

export default class Model<T, K extends Key<T>, I extends Key<T> = never, G = never> {
  constructor(
      readonly tableName: string,
      readonly key: K,
      readonly indices: Array<{attributes: I, name: string}>,
      private readonly generators: Array<ItemGenerator<T, G>>,
      private readonly updaters: Array<ItemUpdater<T, G, any>>) {
  }

  public get(key: KeyValue<T, K>): Promise<T & G> {
    return null as any;
  }

  public add(item: Diff<T, G>): Promise<T & G> {
    return null as any;
  }

  public put(item: Diff<T, G>): Promise<T & G> {
    return null as any;
  }

  public delete(key: KeyValue<T, K>): Promise<T & G> {
    return null as any;
  }

  public update(key: KeyValue<T, K>, attributes: Partial<Diff<T, G>>, conditions?: []): Promise<T & G> {
    return null as any;
  }

  public query<I2 extends I>(index: I2, keyCondition: KeyCondition<T, I2>): Promise<{items: Array<T & G>}> {
    return null as any;
  }

  static define<T>(tableName: string): ModelBuilder<T> {
    return new ModelBuilder<T>(tableName);
  }
}

type Person = {
  id: string;
  name: string;
  email: string;
  age?: number;
};

async function foo() {
  const m = Model.define<Person>('persons')
      .key('id')
      .index(['name', 'age'], 'index-nameAge')
      .generator((item) => ({id: '42'}))
      .generator((item) => ({createdTime: new Date().toJSON(), modifiedTime: new Date().toJSON()}))
      .updater((item) => ({modifiedTime: new Date().toJSON()}))
      .build();

  const person = await m.add({name: 'John', email: 'john@doe.com'});
  await m.update('42', {});
}

// let x: {a: string} & Record<never, never>
//
//
//
// interface Type<T> {
// }
//
// //type Type<T> = (x: T) => TypeToken<T>;
// const TYPE_TOKEN = Symbol() as any;
//
// function Type<T>(): Type<T> {
//   return TYPE_TOKEN;
// }
//
// // const foo2 = token<Person>;
// // const foo3: <T> () => T;
// // type X = typeof foo3;
// //
// // const foo = <T>42;
//
// class Foo<A, B> {
//   constructor(a: Type<A>, b: B) {}
//   get(): A {
//     return 42 as A;
//   }
// }
//
// new Foo(Type<Person>(), 42).get().name
//
//
// Model.define<Person>('persons').key<Key<Person>>(['id', 'age'])
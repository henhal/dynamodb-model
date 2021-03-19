type Couple<T> = [T, T];

type Key<T> = keyof T | Couple<keyof T>;

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

type ItemGenerator<T, G> = (item: Readonly<Omit<T, keyof G>>) => G;
type ItemUpdater<T, G, U extends Partial<T & G>> = (item: Readonly<Partial<T>>) => U;

class ModelBuilder<T, K extends Key<T> = never, I extends Key<T> = never, G = never> {
  private _key: K;
  private _indices: Array<I> = [];
  private _generators: Array<ItemGenerator<T, G>> = [];
  private _updaters: Array<ItemUpdater<T, G, unknown>> = [];

  constructor(private readonly tableName: string) {}

  key<K2 extends Key<T>>(key: K2): ModelBuilder<T, K2, I, G> {
    const builder = this as ModelBuilder<T, K2, I, G>;
    builder._key = key;

    return builder;
  }

  index<I2 extends Key<T>>(index: I2): ModelBuilder<T, K, I | I2, G> {
    const builder = this as ModelBuilder<T, K, I | I2, G>;
    builder._indices.push(index);

    return builder;
  }

  generator<G2>(generator: ItemGenerator<T, G2>): ModelBuilder<T, K, I, G & G2> {
    const builder = this as ModelBuilder<T, K, I, G & G2>;
    builder._generators.push(generator);

    return builder;
  }

  updator<U extends Partial<T & G>>(updater: ItemUpdater<T, G, U>): ModelBuilder<T, K, I, G> {
    const builder = this;
    builder._updaters.push(updater);

    return builder;
  }

  build(): Model<T, K, I, G> {
    return new Model<T, K, I, G>(this.tableName, this._key, this._indices, this._generators, this._updaters);
  }
}

export default class Model<T, K extends Key<T>, I extends Key<T> = never, G = never> {
  readonly key: K;
  readonly indices: Array<I>;
  private readonly generators: Array<ItemGenerator<T, G>>;
  private readonly updaters: Array<ItemUpdater<T, G, unknown>>;

  constructor(
      readonly tableName: string,
      readonly key: K,
      readonly indices: Array<I>,
      private readonly generators: Array<ItemGenerator<T, G>>,
      private readonly updaters: Array<ItemUpdater<T, G, unknown>>) {}

  public get(key: KeyValue<T, K>): Promise<T> {
    return null as any;
  }

  public add(item: Omit<T, G>): Promise<T> {
    return null as any;
  }

  public put(item: Omit<T, G>): Promise<T> {
    return null as any;
  }

  public delete(key: K): Promise<T> {
    return null as any;
  }

  public update(key: KeyValue<T, K>, attributes: Partial<Omit<T, G>>, conditions?: []): Promise<T> {
    return null as any;
  }

  public query<I2 extends I>(index: I2, keyCondition: KeyCondition<T, I2>): Promise<T> {
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

type Type<T> = T;
const TYPE_TOKEN = Symbol();

function Type<T>(): T {
  return TYPE_TOKEN as T;
}

// const foo2 = token<Person>;
// const foo3: <T> () => T;
// type X = typeof foo3;
//
// const foo = <T>42;

class Foo<A, B> {
  constructor(a: Type<A>, b: B) {}
  get(): A {
    return 42 as A;
  }
}

new Foo(Type<Person>(), 42).get().name


Model.define<Person>('persons').key<Key<Person>>(['id', 'age'])
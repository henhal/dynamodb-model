// type Person = {
//   id: string;
//   name: string;
//   email: string;
//   age?: number;
// };
//
// interface Type<T> {
// }
//
// //type Type<T> = (x: T) => TypeToken<T>;
// const TYPE_TOKEN = Symbol('TYPE_TOKEN') as any;
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
// new Foo(Type<Person>(), 42)
# 3JS-Models
A collection of 3D models created from simple ThreeJS geometries, for use in browser web games.

## Use as a submodule
```
git submodule add https://github.com/DominikFelden/3JS-Models.git libs/3JS-Models
```
```js
import { SimpleTree } from './libs/3JS-Models/src/index.js';
scene.add(new SimpleTree());
```
`three` is a peer dependency: the host project provides it. Geometries and materials are created once and shared by all instances.

## Viewer
```
npm install
npm run dev
```
Open the printed URL and pick a model in the menu. New models are registered in `src/registry.js`.

## Tests
`npm test`

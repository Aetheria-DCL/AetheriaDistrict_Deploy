
let gltfShape = new GLTFShape("models/SCENE.glb");
gltfShape.withCollisions = true;
gltfShape.visible = true;

const scene = new Entity('scene')
const transform = new Transform({
    position: new Vector3(8, 0.04, 8),
    rotation: Quaternion.Euler(180, 0, 0),
    scale: new Vector3(.979, .979, .979)
});
scene.addComponentOrReplace(gltfShape)
scene.addComponentOrReplace(transform)

engine.addEntity(scene);

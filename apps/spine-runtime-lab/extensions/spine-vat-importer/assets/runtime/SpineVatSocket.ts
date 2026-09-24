import { _decorator, Mat4, Node } from 'cc';
import type { SpineVatSocketMatrix } from './SpineVatSchema';

const { ccclass, property } = _decorator;

/** 挂点：把 target 节点每帧贴到骨骼上（同官方 sp.Skeleton 的 Sockets）。骨骼要在烘焙时勾过。 */
@ccclass('spinevat.Socket')
export class SpineVatSocket {
  @property({ displayName: 'Bone', tooltip: '骨骼名，必须是烘焙面板里勾过的 Socket 骨骼' })
  bone = '';

  @property({ type: Node, displayName: 'Target', tooltip: '跟随骨骼的节点，放在 VAT 节点下面' })
  target: Node | null = null;
}

const scratch = new Mat4();
const warned = new Set<string>();

/** 骨骼矩阵是骨架空间 = VAT 节点的本地空间，所以直接写 target 的本地矩阵（target 要是 VAT 节点的子节点）。 */
export function syncSockets(sockets: readonly SpineVatSocket[], lookup: (bone: string) => SpineVatSocketMatrix | null): void {
  for (const socket of sockets) {
    const target = socket.target;
    if (!target?.isValid || !socket.bone) continue;
    const m = lookup(socket.bone);
    if (!m) {
      if (!warned.has(socket.bone)) {
        warned.add(socket.bone);
        console.warn(`[SpineVat] 骨骼 ${socket.bone} 没有烘焙 socket 数据，请在烘焙面板勾选后重新烘焙`);
      }
      continue;
    }
    scratch.m00 = m[0]; scratch.m01 = m[2];
    scratch.m04 = m[1]; scratch.m05 = m[3];
    scratch.m12 = m[4]; scratch.m13 = m[5];
    target.matrix = scratch;
  }
}

import { describe, expect, it } from 'vitest';
import { connectedLoader, recommendationFor } from '../../../web/comfyui/lora_model_context.js';

const loader = value => ({ widgets: [{ name: 'unet_name', value }] });
const viaModel = upstream => ({ inputs: [{ type: 'MODEL', link: 1 }], getInputNode: () => upstream });
const recommend = (name, pool = []) => recommendationFor({ name }, pool);

describe('connected LoRA recommendations', () => {
  it('traces only the model edge through a reroute and scoped Set/Get nodes', () => {
    // A disabled video stage still has a configured base while the user browses.
    const base = { ...loader('anima\\custom.safetensors'), mode: 2 };
    const reroute = { type: 'Reroute', inputs: [{ type: '*', link: 1 }], getInputNode: () => base };
    const getter = { type: 'GetNode', findSetter: () => viaModel(reroute) };
    const target = { title: 'Wan', inputs: [{ type: 'CLIP', link: 1 }, { type: 'MODEL', link: 2 }],
      getInputNode: slot => slot === 1 ? getter : loader('wrong.ckpt') };
    expect(connectedLoader(target)).toEqual({ name: 'anima/custom.safetensors', kind: 'diffusion_model' });
  });

  it('does not guess across cycles, unresolved switches or a wired filename', () => {
    const cycle = viaModel(null);
    cycle.getInputNode = () => cycle;
    expect(connectedLoader(cycle)).toBeNull();
    const merge = viaModel(loader('anima/test.safetensors'));
    merge.inputs.push({ type: 'MODEL', link: 2 });
    expect(connectedLoader(merge)).toBeNull();
    const wired = loader('krea2/example.safetensors');
    wired.inputs = [{ name: 'unet_name', type: 'COMBO', link: 1 }];
    expect(connectedLoader(viaModel(wired))).toBeNull();
  });

  it('prefers the exact catalog file, and conflicting records have no recommendation', () => {
    const name = 'anima/custom.safetensors';
    const correct = { name, base_model: 'Krea 2' };
    expect(recommend(name, [{ name: 'other/custom.safetensors', base_model: 'SDXL' }, correct]).family).toBe('Krea 2');
    expect(recommend(name, [correct, { name, base_model: 'Anima' }])).toBeNull();
    expect(recommend('mystery.safetensors', [{ name: 'mystery.safetensors', base_model: 'Unknown' }])).toBeNull();
  });

  it.each([
    ['Wan 2.2/ExampleWAN22I2V14B_q8High.gguf', 'Wan Video 2.2 I2V-A14B', 'HIGH'],
    ['Wan 2.2/ExampleWAN22I2V14B_q8Low.gguf', 'Wan Video 2.2 I2V-A14B', 'LOW'],
    ['wan2.2_t2v_A14B.safetensors', 'Wan Video 2.2 T2V-A14B', ''],
    ['wan2.2_ti2v_5B.safetensors', 'Wan Video 2.2 TI2V-5B', ''],
    ['krea2/custom.safetensors', 'Krea 2', ''],
    ['anima/custom.safetensors', 'Anima', ''],
  ])('uses explicit path evidence for %s', (name, family, stage) => {
    expect(recommend(name)).toEqual({ family, stage });
  });

  it('keeps an unspecified Wan variant and Flux Krea out of guessed families', () => {
    expect(recommend('wan2.2-custom.gguf')).toBeNull();
    expect(recommend('flux1-krea-dev.safetensors')).toBeNull();
  });
});

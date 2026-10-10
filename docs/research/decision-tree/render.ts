// Draft-only checks and diagram generation. This does not execute citizen actions.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { canObtainFoodNow } from './trees/can-obtain-food-now.ts';
import { obtainFoodNow } from './trees/obtain-food-now.ts';
import type { DraftNode, DraftTree } from './draft-types.ts';

import { canObtainResource } from './trees/can-obtain-resource.ts';
import { obtainResource } from './trees/obtain-resource.ts';
import { canBuildResourceBuilding } from './trees/can-build-resource-building.ts';

const draftTrees = [
  canObtainFoodNow,
  obtainFoodNow,
  canObtainResource,
  obtainResource,
  canBuildResourceBuilding,
] as const;

function targets(node: DraftNode): string[] {
  switch (node.kind) {
    case 'decision':
      return [node.yes, node.no];
    case 'step':
    case 'funding':
    case 'resourcePlan':
    case 'preparation':
      return [node.next];
    default:
      return [];
  }
}

export function validateTree(tree: DraftTree): void {
  const fail = (message: string): never => {
    throw new Error(`${tree.name}: ${message}`);
  };
  if (!tree.nodes[tree.entry]) fail(`missing entry ${tree.entry}`);
  let foodTerminals = 0;
  let resourceTerminals = 0;
  let errors = 0;
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(id)) fail(`invalid node ID ${id}`);
    if (
      tree.kind === 'condition' &&
      (node.kind === 'funding' ||
        node.kind === 'preparation' ||
        node.kind === 'resource' ||
        node.kind === 'food' ||
        node.kind === 'error' ||
        (node.kind === 'step' && node.operation === 'selectFundingCombination') ||
        (node.kind === 'resourcePlan' && node.operation === 'estimateAndSelectRoute'))
    )
      fail(`condition contains an action at ${id}`);
    if (tree.kind !== 'condition' && node.kind === 'boolean')
      fail(`non-action success terminal at ${id}`);
    if (tree.kind === 'foodAction' && node.kind === 'resource')
      fail(`non-food success terminal at ${id}`);
    if (tree.kind === 'resourceAction' && node.kind === 'food')
      fail(`non-exact-resource success terminal at ${id}`);
    if (node.kind === 'food') foodTerminals++;
    if (node.kind === 'resource') resourceTerminals++;
    if (node.kind === 'error') errors++;
    for (const target of targets(node)) {
      if (!tree.nodes[target]) fail(`${id} has missing continuation ${String(target)}`);
    }
  }
  if (tree.kind === 'foodAction' && (foodTerminals === 0 || errors !== 1)) {
    fail('requires food-producing success terminals and exactly one error terminal');
  }
  if (tree.kind === 'resourceAction' && (resourceTerminals === 0 || errors !== 1)) {
    fail('requires resource-producing success terminals and exactly one error terminal');
  }
  const active = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): void {
    if (active.has(id)) fail(`cycle at ${id}`);
    if (visited.has(id)) return;
    active.add(id);
    for (const target of targets(tree.nodes[id])) visit(target);
    active.delete(id);
    visited.add(id);
  }
  visit(tree.entry);
  for (const id of Object.keys(tree.nodes)) {
    if (!visited.has(id)) fail(`unreachable node ${id}`);
  }
}

export function renderMermaid(tree: DraftTree): string {
  validateTree(tree);
  const lines = ['flowchart TD'];
  for (const [id, node] of Object.entries(tree.nodes)) {
    const label = (node.kind === 'boolean' ? (node.value ? 'True' : 'False') : node.label)
      .replaceAll('"', '&quot;')
      .replaceAll('\n', '<br/>');
    const shape =
      node.kind === 'decision'
        ? `{"${label}"}`
        : ['food', 'resource', 'boolean', 'error'].includes(node.kind)
          ? `(["${label}"])`
          : `["${label}"]`;
    lines.push(`    ${id}${shape}`);
  }
  for (const [id, node] of Object.entries(tree.nodes)) {
    if (node.kind === 'decision') {
      lines.push(`    ${id} -->|Yes| ${node.yes}`, `    ${id} -->|No| ${node.no}`);
    } else if (['step', 'funding', 'resourcePlan', 'preparation'].includes(node.kind)) {
      lines.push(`    ${id} --> ${targets(node)[0]}`);
    }
  }
  return lines.join('\n');
}

// Replace only the generated diagram, leaving the planning prose untouched.
export function updateDiagram(document: string, tree: DraftTree): string {
  const fences = document.match(/```mermaid\r?\n[\s\S]*?```/g);
  if (fences?.length !== 1) throw new Error(`${tree.name}: expected exactly one Mermaid diagram`);
  return document.replace(fences[0], `\`\`\`mermaid\n${renderMermaid(tree)}\n\`\`\``);
}

function main(): void {
  const check = process.argv.includes('--check');
  const directory = new URL('./', import.meta.url);
  // Validate all graphs and prepare all outputs before writing any document.
  const outputs = draftTrees.map((tree) => {
    const file = new URL(tree.document, directory);
    const current = readFileSync(file, 'utf8');
    return { file, current, generated: updateDiagram(current, tree) };
  });
  for (const { file, current, generated } of outputs) {
    if (check && current !== generated) throw new Error(`${file.pathname}: diagram is out of date`);
    if (!check && current !== generated) writeFileSync(file, generated);
  }
  console.log(
    check ? 'Draft graphs valid; diagrams up to date.' : 'Draft graphs valid; diagrams generated.',
  );
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main();

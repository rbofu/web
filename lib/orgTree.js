// Small helpers for working with the organisational unit tree.
// A unit is { id, name, parentId } — parentId is null for the root.

function getChildren(units, parentId){
  return units.filter(u => String(u.parentId) === String(parentId));
}

// Returns [rootId, ...all descendant ids], as strings, for scoping visibility.
function getSubtreeIds(units, rootId){
  const ids = [String(rootId)];
  const stack = [rootId];
  while (stack.length){
    const current = stack.pop();
    for (const child of getChildren(units, current)){
      ids.push(String(child.id));
      stack.push(child.id);
    }
  }
  return ids;
}

// Builds "Parent / Child / Grandchild" style breadcrumb labels for a flat select list.
function withDepthLabels(units){
  const byParent = {};
  units.forEach(u => {
    const key = String(u.parentId);
    (byParent[key] = byParent[key] || []).push(u);
  });
  const out = [];
  function walk(parentId, depth){
    (byParent[String(parentId)] || []).forEach(u => {
      out.push({ id: u.id, name: u.name, depth, label: `${'— '.repeat(depth)}${u.name}` });
      walk(u.id, depth + 1);
    });
  }
  walk(null, 0);
  return out;
}

module.exports = { getChildren, getSubtreeIds, withDepthLabels };

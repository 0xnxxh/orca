// TypeScript 7 is a native CLI; AST consumers still need the legacy JavaScript API.
import ts from 'typescript-api'

function isDirectDisplayExpressionParent(parent, child) {
  if (
    ts.isParenthesizedExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isSatisfiesExpression(parent)
  ) {
    return parent.expression === child
  }
  if (ts.isConditionalExpression(parent)) {
    return parent.whenTrue === child || parent.whenFalse === child
  }
  if (ts.isBinaryExpression(parent)) {
    return [
      ts.SyntaxKind.PlusToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionToken
    ].includes(parent.operatorToken.kind)
  }
  return ts.isTemplateSpan(parent) || ts.isTemplateExpression(parent)
}

export function isRenderedJsxExpression(node) {
  let current = node.parent
  while (current) {
    if (ts.isJsxExpression(current)) {
      return (
        ts.isJsxElement(current.parent) ||
        ts.isJsxFragment(current.parent) ||
        ts.isJsxSelfClosingElement(current.parent)
      )
    }
    if (
      ts.isConditionalExpression(current) ||
      ts.isParenthesizedExpression(current) ||
      ts.isTemplateExpression(current) ||
      ts.isNoSubstitutionTemplateLiteral(current)
    ) {
      if (ts.isConditionalExpression(current) && current.condition === node) {
        return false
      }
      current = current.parent
      continue
    }
    if (ts.isBinaryExpression(current)) {
      const operator = current.operatorToken.kind
      if (
        ![
          ts.SyntaxKind.PlusToken,
          ts.SyntaxKind.AmpersandAmpersandToken,
          ts.SyntaxKind.BarBarToken,
          ts.SyntaxKind.QuestionQuestionToken
        ].includes(operator) ||
        (operator !== ts.SyntaxKind.PlusToken && current.left === node)
      ) {
        return false
      }
      current = current.parent
      continue
    }
    return false
  }
  return false
}

function assignedVariableName(node) {
  let current = node
  while (current.parent && isDirectDisplayExpressionParent(current.parent, current)) {
    current = current.parent
  }
  const parent = current.parent
  if (
    parent &&
    ts.isVariableDeclaration(parent) &&
    parent.initializer === current &&
    ts.isIdentifier(parent.name)
  ) {
    return parent.name.text
  }
  return parent &&
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
    parent.right === current &&
    ts.isIdentifier(parent.left)
    ? parent.left.text
    : undefined
}

export function isAssignedToRenderedVariable(node) {
  if (ts.isTemplateExpression(node)) {
    return false
  }
  const name = assignedVariableName(node)
  if (!name) {
    return false
  }
  let owner = node.parent
  while (owner && !ts.isFunctionLike(owner) && !ts.isSourceFile(owner)) {
    owner = owner.parent
  }
  if (!owner) {
    return false
  }
  let rendered = false
  function visit(current) {
    if (rendered) {
      return
    }
    if (ts.isIdentifier(current) && current.text === name && isRenderedJsxExpression(current)) {
      rendered = true
      return
    }
    ts.forEachChild(current, visit)
  }
  visit(owner)
  return rendered
}

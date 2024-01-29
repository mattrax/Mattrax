// @ts-nocheck // TODO

import * as ts from "typescript";
import * as fs from "fs";

interface DocEntry {
  name?: string;
  fileName?: string;
  documentation?: string;
  type?: string;
  constructors?: DocEntry[];
  parameters?: DocEntry[];
  returnType?: string;
}

/** Generate documentation for all classes in a set of .ts files */
function generateDocumentation(
  fileNames: string[],
  options: ts.CompilerOptions
): void {
  // Build a program using the set of root file names in fileNames
  let program = ts.createProgram(fileNames, options);

  // Get the checker, we will use it to find more about classes
  let checker = program.getTypeChecker();
  let output: DocEntry[] = [];

  // Visit every sourceFile in the program
  for (const sourceFile of program.getSourceFiles()) {
    if (!sourceFile.isDeclarationFile) {
      // Walk the tree to search for classes
      ts.forEachChild(sourceFile, visit);
    }
  }

  // print out the doc
  fs.writeFileSync("classes.json", JSON.stringify(output, undefined, 4));

  return;

  /** visit nodes finding exported classes */
  function visit(node: ts.Node) {
    // Only consider exported nodes
    if (!isNodeExported(node)) {
      return;
    }

    if (ts.isModuleDeclaration(node)) {
      // This is a namespace, visit its children
      ts.forEachChild(node, visit);
    } else if (node.name) {
      // This is a top level class, get its symbol
      let symbol = checker.getSymbolAtLocation(node.name);
      if (symbol) {
        // TODO: Fix this
        // if (symbol.getName() === "Schema") {
        //   const type = checker.getTypeOfSymbol(symbol);
        //   const type2 = checker.getTypeOfSymbolAtLocation(
        //     symbol,
        //     symbol.valueDeclaration!
        //   );

        //   console.log(
        //     type,
        //     checker.typeToString(type),
        //     checker.typeToString(type2)
        //   );
        // }

        if (symbol.getName() === "testing") {
          const type = checker.getTypeOfSymbolAtLocation(
            symbol,
            symbol.valueDeclaration!
          );

          const ty = type.getCallSignatures()[0].getReturnType();

          for (const prop of ty.getProperties()) {
            const url = prop.getName();
            const value = checker.getTypeOfSymbol(prop);

            for (const prop of value.getProperties()) {
              const method = prop.getName();
              const value = checker.getTypeOfSymbol(prop);

              console.log("ENDPOINT", method, url, checker.typeToString(value));
            }
          }
        }
        output.push(serializeClass(symbol));
      }
      // No need to walk any further, class expressions/inner declarations
      // cannot be exported
    }
  }

  /** Serialize a symbol into a json object */
  function serializeSymbol(symbol: ts.Symbol): DocEntry {
    return {
      name: symbol.getName(),
      documentation: ts.displayPartsToString(
        symbol.getDocumentationComment(checker)
      ),
      type: checker.typeToString(
        checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
      ),
    };
  }

  /** Serialize a class symbol information */
  function serializeClass(symbol: ts.Symbol) {
    let details = serializeSymbol(symbol);

    // Get the construct signatures
    let constructorType = checker.getTypeOfSymbolAtLocation(
      symbol,
      symbol.valueDeclaration!
    );
    details.constructors = constructorType
      .getConstructSignatures()
      .map(serializeSignature);
    return details;
  }

  /** Serialize a signature (call or construct) */
  function serializeSignature(signature: ts.Signature) {
    return {
      parameters: signature.parameters.map(serializeSymbol),
      returnType: checker.typeToString(signature.getReturnType()),
      documentation: ts.displayPartsToString(
        signature.getDocumentationComment(checker)
      ),
    };
  }

  /** True if this is visible outside this file, false otherwise */
  function isNodeExported(node: ts.Node): boolean {
    return (
      (ts.getCombinedModifierFlags(node as ts.Declaration) &
        ts.ModifierFlags.Export) !==
        0 ||
      (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile)
    );
  }
}

console.log("Generating OpenAPI documentation...");

// TODO: Parse config file for TS file path & export name

generateDocumentation(["./api.ts"], {
  noEmit: true,
  // target: ts.ScriptTarget.ES5,
  // module: ts.ModuleKind.CommonJS,
});

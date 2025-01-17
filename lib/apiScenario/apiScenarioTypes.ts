import { Operation, SwaggerExample } from "../swagger/swaggerTypes";

//#region Common

type TransformRaw<T, Additional = {}, OptionalKey extends keyof T = never> = {
  [P in OptionalKey]?: T[P];
} & {
  [P in Exclude<keyof T, OptionalKey | keyof Additional>]-?: Exclude<T[P], undefined>;
} & Additional;

export type VarType = Variable["type"];

export type VarValue = boolean | number | string | VarValue[] | { [key: string]: VarValue };

export type Variable =
  | BoolVariable
  | IntVariable
  | StringVariable
  | SecureStringVariable
  | ArrayVariable
  | ObjectVariable
  | SecureObjectVariable;

export interface StringVariable {
  type: "string";
  value?: string;
  prefix?: string;
}

export interface SecureStringVariable {
  type: "secureString";
  value?: string;
  prefix?: string;
}

export interface BoolVariable {
  type: "bool";
  value?: boolean;
}

export interface IntVariable {
  type: "int";
  value?: number;
}

export interface ObjectVariable {
  type: "object";
  value?: { [key: string]: VarValue };
  patches?: JsonPatchOp[];
}

export interface SecureObjectVariable {
  type: "secureObject";
  value?: { [key: string]: VarValue };
  patches?: JsonPatchOp[];
}

export interface ArrayVariable {
  type: "array";
  value?: VarValue[];
  patches?: JsonPatchOp[];
}

export interface RawVariableScope {
  variables?: {
    [variableName: string]: string | Variable;
  };
}

export interface VariableScope {
  variables: {
    [variableName: string]: Variable;
  };
  requiredVariables: string[];
  secretVariables: string[];
}

export interface OutputVariables {
  [variableName: string]: {
    type?: VarType;
    fromRequest: string;
    fromResponse: string;
  };
}

export interface ReadmeTag {
  name: string;
  filePath: string;
  tag?: string;
}

//#endregion

//#region Step Base

type RawStepBase = RawVariableScope & {
  step?: string;
  description?: string;
  outputVariables?: OutputVariables;
};

type StepBase = VariableScope & {
  isPrepareStep?: boolean;
  isCleanUpStep?: boolean;
};

export type Step = StepRestCall | StepArmTemplate;
export type RawStep = RawStepOperation | RawStepExample | RawStepArmTemplate | RawStepArmScript;

//#endregion

//#region Step RestCall

export type RawStepExample = RawStepBase & {
  exampleFile: string;
  requestUpdate?: JsonPatchOp[];
  responseUpdate?: JsonPatchOp[];
};

export type RawStepOperation = RawStepBase & {
  operationId: string;
  readmeTag?: string;
  parameters?: { [parameterName: string]: VarValue };
  responses?: StepResponseAssertion;
};

export type StepRestCallExample = StepBase & {};

export type StepRestCall = StepBase & {
  type: "restCall";
  step: string;
  description?: string;
  operationId: string;
  operation: Operation;
  exampleFile?: string;
  parameters: SwaggerExample["parameters"];
  responses: SwaggerExample["responses"];
  responseAssertion?: StepResponseAssertion;
  outputVariables?: OutputVariables;
  externalReference?: boolean;
  _resolvedParameters?: SwaggerExample["parameters"];
};

export type StepResponseAssertion = {
  [statusCode: number]:
    | {
        headers?: { [headerName: string]: string };
        body?: any;
      }
    | JsonPatchOpTest[];
};

//#endregion

//#region Step Arm Deployment Script
export type RawStepArmScript = RawStepBase & {
  armDeploymentScript: string;
  arguments?: string;
  environmentVariables?: Array<{
    name: string;
    value: string;
  }>;
};
//#endregion

//#region Step Arm Template

export type ArmTemplateVariableType =
  | "string"
  | "securestring"
  | "int"
  | "bool"
  | "object"
  | "secureObject"
  | "array";

export type RawStepArmTemplate = RawStepBase & {
  armTemplate: string;
};

export type StepArmTemplate = TransformRaw<
  RawStepArmTemplate,
  StepBase & {
    type: "armTemplateDeployment";
    armTemplatePayload: ArmTemplate;
  },
  "description"
>;

export interface ArmResource {
  name: string;
  apiVersion: string;
  type: string;
  location?: string;
  properties?: object;
}

export type ArmDeploymentScriptResource = ArmResource & {
  type: "Microsoft.Resources/deploymentScripts";
  kind: "AzurePowerShell" | "AzureCLI";
  identity?: {
    type: "UserAssigned";
    userAssignedIdentities: {
      [name: string]: {};
    };
  };
  properties: {
    arguments?: string;
    azPowerShellVersion?: string;
    azCliVersion?: string;
    scriptContent: string;
    forceUpdateTag?: string;
    timeout?: string;
    cleanupPreference?: string;
    retentionInterval?: string;
    environmentVariables?: Array<{
      name: string;
      value?: string;
      secureValue?: string;
    }>;
  };
};

export interface ArmTemplate {
  $schema?: string;
  contentVersion?: string;
  parameters?: {
    [name: string]: {
      type: ArmTemplateVariableType;
      defaultValue?: any;
    };
  };
  outputs?: {
    [name: string]: {
      condition?: string;
      type: ArmTemplateVariableType;
    };
  };
  resources?: ArmResource[];
}

//#endregion

//#region JsonPatchOp

export interface JsonPatchOpAdd {
  add: string;
  value: any;
}

export interface JsonPatchOpRemove {
  remove: string;
  oldValue?: any;
}

export interface JsonPatchOpReplace {
  replace: string;
  value: any;
  oldValue?: any;
}

export interface JsonPatchOpCopy {
  copy: string;
  from: string;
}

export interface JsonPatchOpMove {
  move: string;
  from: string;
}

export interface JsonPatchOpTest {
  test: string;
  value?: any;
  expression?: string;
}

export type JsonPatchOp =
  | JsonPatchOpAdd
  | JsonPatchOpRemove
  | JsonPatchOpReplace
  | JsonPatchOpCopy
  | JsonPatchOpMove
  | JsonPatchOpTest;

//#endregion

//#region Scenario

export type RawScenario = RawVariableScope & {
  scenario?: string;
  shareScope?: boolean;
  description?: string;
  steps: RawStep[];
};

export type Scenario = TransformRaw<
  RawScenario,
  {
    steps: Step[];
    _scenarioDef: ScenarioDefinition;
  } & VariableScope
>;

//#endregion

//#region ScenarioDefinitionFile
export type RawScenarioDefinition = RawVariableScope & {
  scope?: "ResourceGroup" | "Subscription" | "Tenant" | "None";
  prepareSteps?: RawStep[];
  scenarios: RawScenario[];
  cleanUpSteps?: RawStep[];
};

export type ScenarioDefinition = TransformRaw<
  RawScenarioDefinition,
  VariableScope & {
    prepareSteps: Step[];
    scenarios: Scenario[];
    cleanUpSteps: Step[];
    _filePath: string;
    _swaggerFilePaths: string[];
  }
>;
//#endregion

//#region Runner specific types
export interface NewmanReport {
  executions: NewmanExecution[];
  timings: any;
  variables: { [variableName: string]: Variable };
}

export interface NewmanExecution {
  request: NewmanRequest;
  response: NewmanResponse;
  annotation?: any;
  assertions: NewmanAssertion[];
}

export interface NewmanAssertion {
  name: string;
  test: string;
  message: string;
  stack: string;
}
export interface NewmanRequest {
  url: string;
  method: string;
  headers: { [key: string]: any };
  body: string;
}

export interface NewmanResponse {
  statusCode: number;
  headers: { [key: string]: any };
  body: string;
  responseTime: number;
}

export interface TestResources {
  ["test-resources"]: Array<{ [key: string]: string }>;
}

//#endregion

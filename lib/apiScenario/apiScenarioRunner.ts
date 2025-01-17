import { HttpMethods } from "@azure/core-http";
import { JsonLoader } from "../swagger/jsonLoader";
import { getLazyBuilder } from "../util/lazyBuilder";
import { getRandomString } from "../util/utils";
import {
  ArmTemplate,
  ScenarioDefinition,
  Scenario,
  Step,
  StepArmTemplate,
  StepRestCall,
} from "./apiScenarioTypes";
import { EnvironmentVariables, VariableEnv } from "./variableEnv";

export interface ApiScenarioRunnerOption {
  env: EnvironmentVariables;
  client: ApiScenarioRunnerClient;
  jsonLoader: JsonLoader;
  resolveVariables?: boolean;
  skipCleanUp?: boolean;
}

export interface ArmDeployment {
  deploymentName: string;
  step: StepArmTemplate;
  details: {
    scope: string;
    subscriptionId: string;
    resourceGroupName: string;
  };
}

export interface Scope {
  provisioned?: boolean;
  type: ScenarioDefinition["scope"];
  prepareSteps: Step[];
  cleanUpSteps: Step[];
  env: VariableEnv;
}

export interface ApiScenarioClientRequest {
  method: HttpMethods;
  path: string;
  pathVariables?: { [variableName: string]: string };
  headers: { [headerName: string]: string };
  query: { [key: string]: string };
  body?: any;
}

export interface ApiScenarioRunnerClient {
  prepareScenario(scenario: Scenario, env: VariableEnv): Promise<void>;

  createResourceGroup(
    subscriptionId: string,
    resourceGroupName: string,
    location: string
  ): Promise<void>;

  deleteResourceGroup(subscriptionId: string, resourceGroupName: string): Promise<void>;

  sendRestCallRequest(
    request: ApiScenarioClientRequest,
    step: StepRestCall,
    env: VariableEnv
  ): Promise<void>;

  sendArmTemplateDeployment(
    armTemplate: ArmTemplate,
    armDeployment: ArmDeployment,
    step: StepArmTemplate,
    env: VariableEnv
  ): Promise<void>;
}

export class ApiScenarioRunner {
  private jsonLoader: JsonLoader;
  private client: ApiScenarioRunnerClient;
  private env: EnvironmentVariables;
  private scopeTracking: { [scopeName: string]: Scope };
  private resolveVariables: boolean;
  private skipCleanUp: boolean;

  public setSkipCleanUp(skipCleanUp: boolean) {
    this.skipCleanUp = skipCleanUp;
  }

  private doProvisionScope = getLazyBuilder("provisioned", async (scope: Scope) => {
    if (scope.type === "ResourceGroup") {
      await this.client.createResourceGroup(
        scope.env.getRequiredString("subscriptionId"),
        scope.env.getRequiredString("resourceGroupName"),
        scope.env.getRequiredString("location")
      );
    }
    for (const step of scope.prepareSteps) {
      await this.executeStep(step, scope.env, scope);
    }
    return true;
  });

  public constructor(opts: ApiScenarioRunnerOption) {
    this.env = opts.env;
    this.client = opts.client;
    this.jsonLoader = opts.jsonLoader;
    this.resolveVariables = opts.resolveVariables ?? true;
    this.skipCleanUp = opts.skipCleanUp ?? false;
    this.scopeTracking = {};
  }

  private async prepareScope(scenario: Scenario): Promise<Scope> {
    const scopeName = scenario.shareScope ? "_defaultScope" : `_randomScope_${getRandomString()}`;
    let scope = this.scopeTracking[scopeName];
    if (scope === undefined) {
      const scenarioDef = scenario._scenarioDef;
      // Variable scope: ScenarioDef <= RuntimeScope <= Scenario <= Step
      const scopeEnv =
        // RuntimeScope
        new VariableEnv(
          // ScenarioDef
          new VariableEnv().setBatch(scenarioDef.variables)
        ).setBatchEnv(this.env);
      scope = {
        type: scenarioDef.scope,
        prepareSteps: scenarioDef.prepareSteps,
        cleanUpSteps: scenarioDef.cleanUpSteps,
        env: scopeEnv,
      };

      if (scope.type === "None") {
        throw new Error(`Scope is not supported yet: ${scope.type}`);
      }

      if (scope.env.get("resourceGroupName") === undefined) {
        scope.env.set("resourceGroupName", {
          type: "string",
          prefix: "apiTest-",
        });
      }

      this.generateValueFromPrefix(scope.env);

      this.scopeTracking[scopeName] = scope;
    }

    return scope;
  }

  private async cleanUpScope(scope: Scope): Promise<void> {
    for (const step of scope.cleanUpSteps) {
      await this.executeStep(step, scope.env, scope);
    }
    if (scope.type === "ResourceGroup") {
      const subscriptionId = scope.env.getRequiredString("subscriptionId");
      const resourceGroupName = scope.env.getRequiredString("resourceGroupName");
      await this.client.deleteResourceGroup(subscriptionId, resourceGroupName);
    }
  }

  private generateValueFromPrefix(env: VariableEnv) {
    for (const [_, v] of env.getVariables()) {
      if (v.type === "string" || v.type === "secureString") {
        if (v.prefix !== undefined && v.value === undefined) {
          v.value = v.prefix + getRandomString();
        }
      }
    }
  }

  public async executeScenario(scenario: Scenario) {
    const scope = await this.prepareScope(scenario);
    const scenarioEnv = new VariableEnv(scope.env).setBatch(scenario.variables);

    this.generateValueFromPrefix(scenarioEnv);

    await this.client.prepareScenario(scenario, scenarioEnv);

    await this.doProvisionScope(scope);

    try {
      for (const step of scenario.steps) {
        await this.executeStep(step, scenarioEnv, scope);
      }
    } catch (e) {
      throw new Error(`Failed to execute scenario: ${scenario.scenario}: ${e.message}`);
    } finally {
      if (!this.skipCleanUp) {
        await this.cleanUpScope(scope);
      }
    }
  }

  public async executeStep(step: Step, env: VariableEnv, scope: Scope) {
    const stepEnv = new VariableEnv(env).setBatch(step.variables);

    this.generateValueFromPrefix(stepEnv);

    if (this.resolveVariables) {
      stepEnv.resolve();
    }

    try {
      switch (step.type) {
        case "restCall":
          await this.executeRestCallStep(step, stepEnv);
          break;
        case "armTemplateDeployment":
          await this.executeArmTemplateStep(step, stepEnv, scope);
          break;
      }
    } catch (error) {
      throw new Error(
        `Failed to execute step ${step.step}: ${(error as any).message} \n${error.stack}`
      );
    }
  }

  private async executeRestCallStep(step: StepRestCall, env: VariableEnv) {
    let req: ApiScenarioClientRequest = {
      method: step.operation._method.toUpperCase() as HttpMethods,
      path: step.operation._path._pathTemplate.replace(/{([a-z0-9_$]+)}/gi, (_, p1) => `$(${p1})`),
      pathVariables: {},
      headers: {},
      query: {},
    };

    for (const p of step.operation.parameters ?? []) {
      const param = this.jsonLoader.resolveRefObj(p);

      const paramVal = step.parameters[param.name];
      if (paramVal === undefined) {
        if (param.required) {
          throw new Error(`Parameter value for "${param.name}" is not found in step: ${step.step}`);
        } else {
          continue;
        }
      }

      switch (param.in) {
        case "path":
          req.pathVariables![param.name] = paramVal;
          break;
        case "query":
          req.query[param.name] = paramVal;
          break;
        case "header":
          req.headers[param.name] = paramVal;
          break;
        case "body":
          req.body = paramVal;
          break;
        default:
          throw new Error(`Parameter "in" not supported: ${param.in}`);
      }
    }

    if (this.resolveVariables) {
      req = env.resolveObjectValues(req);
    }

    await this.client.sendRestCallRequest(req, step, env);

    if (this.resolveVariables && !step._resolvedParameters) {
      step._resolvedParameters = env.resolveObjectValues(step.parameters);
    }
  }

  private async executeArmTemplateStep(step: StepArmTemplate, env: VariableEnv, scope: Scope) {
    const subscriptionId = env.getRequiredString("subscriptionId");
    const resourceGroupName = env.getRequiredString("resourceGroupName");

    const armDeployment: ArmDeployment = {
      deploymentName: `${resourceGroupName}-deploy-${getRandomString()}`,
      step,
      details: {
        scope: scope.type,
        subscriptionId,
        resourceGroupName,
      },
    };

    if (this.resolveVariables) {
      step.armTemplatePayload = env.resolveObjectValues(step.armTemplatePayload);
    }

    await this.client.sendArmTemplateDeployment(step.armTemplatePayload, armDeployment, step, env);
  }
}

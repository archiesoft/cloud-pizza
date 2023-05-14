import * as cdk from '@aws-cdk/core';
import lambda = require('@aws-cdk/aws-lambda');
import apigw = require('@aws-cdk/aws-apigatewayv2');
import sfn = require('@aws-cdk/aws-stepfunctions');
import tasks = require('@aws-cdk/aws-stepfunctions-tasks');
import * as sns from '@aws-cdk/aws-sns';
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from '@aws-cdk/aws-iam';


export class TheStateMachineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    /**
     * Step Function Starts Here
     */
     
    //The first thing we need to do is see if they are asking for pineapple on a pizza
    let pineappleCheckLambda = new lambda.Function(this, 'pineappleCheckLambdaHandler', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns'),
      handler: 'orderPizza.handler'
    });

    // Step functions are built up of steps, we need to define our first step
    const orderPizza = new tasks.LambdaInvoke(this, "Order Pizza Job", {
      lambdaFunction: pineappleCheckLambda,
      inputPath: '$.flavour',
      resultPath: '$.pineappleAnalysis',
      payloadResponseOnly: true
    });

    // Pizza Order failure step defined
    const pineappleDetected = new sfn.Fail(this, 'Sorry, We Dont add Pineapple', {
      cause: 'They asked for Pineapple',
      error: 'Failed To Make Pizza',
    });
    
    //As per normal flow, we process the payment first and send request to make pizza
    //create Lambda to process the payment

    //invoke process payment lambda function
    const processPaymentLambda = new lambda.Function(this, 'snsNotify', {
      runtime: lambda.Runtime.NODEJS_12_X,
      code: lambda.Code.fromAsset('lambda-fns'),
      handler: 'handleProcessPayment.handler'
    }); 

    const pizzaFailureTopic = new sns.Topic(this, 'PizzaFailureTopic');
    const message = 'Payment processing failed';
    const sendNotification = new tasks.SnsPublish(this, 'Publish Payment Failed to SNS', {
      topic: pizzaFailureTopic,
      message: JSON.parse(message),
      subject: 'Payment Failed'
    }); 

    //invoke processPayment
    const processPayment =  new tasks.LambdaInvoke(this, 'NotifyPaymentFailureLambda', {
      lambdaFunction: processPaymentLambda,
      inputPath: '$.amount',
      resultPath: '$.paymentStatus',
      payloadResponseOnly: true
    })
    //notify through sns in Lambda function, payment fails
    .addCatch(sendNotification, {
      errors: ['States.ALL'],
      resultPath: '$.error'
    });      

    // If they didnt ask for pineapple let's cook the pizza
    const cookPizza = new tasks.LambdaInvoke(this, "Cook Pizza", {
      lambdaFunction: pineappleCheckLambda,
      inputPath: '$.flavour',
      resultPath: '$.pineappleAnalysis',
      payloadResponseOnly: true
    });

    const pizzaDelivered = new sfn.Succeed(this, 'PizzaDelivered');
    
    //Express Step function definition
    let definition = sfn.Chain
    .start(orderPizza)
    .next(new sfn.Choice(this, 'With Pineapple?') // Logical choice added to flow
        // Look at the "status" field
        .when(sfn.Condition.booleanEquals('$.pineappleAnalysis.containsPineapple', true), pineappleDetected)
        // if flavour is pepperoni, 
        .otherwise(processPayment))
        //if payment succeeded, prepare/cook pizza
        .next(cookPizza)
        //Step function success
        .next(pizzaDelivered);

    // Step functions are built up of steps, we need to define our first step    
    let stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      definition,
      timeout: cdk.Duration.minutes(5),
      tracingEnabled: true,
      stateMachineType: sfn.StateMachineType.EXPRESS
    });

    /**
     * HTTP API Definition
     */
    // defines an API Gateway HTTP API resource backed by our step function


    // We need to give our HTTP API permission to invoke our step function
    const httpApiRole = new Role(this, 'HttpApiRole', {
      assumedBy: new ServicePrincipal('apigateway.amazonaws.com'),
      inlinePolicies: {
        AllowSFNExec: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['states:StartSyncExecution'],
              effect: Effect.ALLOW,
              resources: [stateMachine.stateMachineArn]
            })
          ]
        })
      }
    })

    const api = new apigw.HttpApi(this, 'the-state-machine-api', {
      createDefaultStage: true,
    });

    // create an AWS_PROXY integration between the HTTP API and our Step Function
    const integ = new apigw.CfnIntegration(this, 'Integ', {
      apiId: api.httpApiId,
      integrationType: 'AWS_PROXY',
      connectionType: 'INTERNET',
      integrationSubtype: 'StepFunctions-StartSyncExecution',
      credentialsArn: httpApiRole.roleArn,
      requestParameters: {
        Input: "$request.body",
        StateMachineArn: stateMachine.stateMachineArn
      },
      payloadFormatVersion: '1.0',
      timeoutInMillis: 10000,
    });

    new apigw.CfnRoute(this, 'DefaultRoute', {
      apiId: api.httpApiId,
      routeKey: apigw.HttpRouteKey.DEFAULT.key,
      target: `integrations/${integ.ref}`,
    });

    // output the URL of the HTTP API
    new cdk.CfnOutput(this, 'HTTP API Url', {
      value: api.url ?? 'Something went wrong with the deploy'
    });
  }
}

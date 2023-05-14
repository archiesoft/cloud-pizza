import * as sns from '@aws-cdk/aws-sns';
import sfn = require('@aws-cdk/aws-stepfunctions');
import tasks = require('@aws-cdk/aws-stepfunctions-tasks');

exports.handler = async function(event:any, _context:any) {
    const amount = event.amount;
    // Simulate pseudo payment processing
    const isPaymentSuccessful = Math.random() < amount;

    let paymentStatus;
    if (isPaymentSuccessful) {
        paymentStatus = 'SUCCESS';
    } else {
        paymentStatus = 'FAILURE';
    }
    return paymentStatus;
}
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as eks from "@pulumi/eks";
import * as k8s from "@pulumi/kubernetes";

// 1. Pulumi Configuration (Parameterization)
// This section fulfills the "Parameterize image and resource sizes" requirement.
const config = new pulumi.Config();
const containerImageName = config.get("containerImageName") || "holidays-api"; // Parameterized Name
const cpuRequest = config.get("cpuRequest") || "100m";
const memoryRequest = config.get("memoryRequest") || "256Mi";

// Pulumi Secret
const apiKeySecret = new pulumi.Config("app").requireSecret("apiKey");

// 2. Create a Private ECR Repository using the Parameterized Name
const repo = new aws.ecr.Repository(containerImageName, {
    forceDelete: true,
});

// 3. Build and Publish the Docker image to ECR using the Parameterized Name
const image = new awsx.ecr.Image(containerImageName, {
    repositoryUrl: repo.repositoryUrl,
    context: "../app",
    platform: "linux/amd64",
});

// 4. VPC with Single NAT Gateway
const vpc = new awsx.ec2.Vpc("eks-vpc", {
    cidrBlock: "10.0.0.0/16",
    natGateways: { strategy: "Single" }, 
    subnetSpecs: [
        { type: awsx.ec2.SubnetType.Public, name: "public" },
        { type: awsx.ec2.SubnetType.Private, name: "private" },
    ],
});

// 5. IAM Role for EKS Nodes
const nodeRole = new aws.iam.Role("eks-node-role", {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ec2.amazonaws.com" }),
});

const policyArns = [
    "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy",
    "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy",
    "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly",
];

policyArns.forEach((arn, index) => 
    new aws.iam.RolePolicyAttachment(`eks-node-policy-${index}`, {
        policyArn: arn,
        role: nodeRole,
    })
);

// 6. EKS Cluster
const cluster = new eks.Cluster("eks-cluster", {
    vpcId: vpc.vpcId,
    publicSubnetIds: vpc.publicSubnetIds,
    privateSubnetIds: vpc.privateSubnetIds,
    skipDefaultNodeGroup: true,
    instanceRole: nodeRole,
});

// 7. Kubernetes Provider
const provider = new k8s.Provider("k8s-provider", {
    kubeconfig: cluster.kubeconfig.apply(JSON.stringify),
});

// 8. Managed Node Group
const nodeGroup = new eks.ManagedNodeGroup("eks-managed-ng", {
    cluster: cluster,
    nodeGroupName: "eks-spot-nodes",
    nodeRoleArn: nodeRole.arn,
    subnetIds: vpc.privateSubnetIds,
    instanceTypes: ["t3.small"],
    capacityType: "SPOT",
    scalingConfig: {
        desiredSize: 2,
        minSize: 1,
        maxSize: 3,
    },
}, { providers: { kubernetes: provider } });

// 9. Deploy the App
const ns = new k8s.core.v1.Namespace("app-ns", {
    metadata: { name: "holidays-api" },
}, { provider });

const appLabels = { app: "holidays-api" };
new k8s.apps.v1.Deployment("app-deploy", {
    metadata: { namespace: ns.metadata.name, labels: appLabels },
    spec: {
        replicas: 2,
        selector: { matchLabels: appLabels },
        template: {
            metadata: { labels: appLabels },
            spec: {
                containers: [{
                    name: "holidays-api",
                    // We now use the build URI directly (which uses the parameterized name)
                    image: image.imageUri, 
                    resources: {
                        requests: {
                            cpu: cpuRequest,
                            memory: memoryRequest,
                        },
                    },
                    env: [{ name: "APP_SECRET_KEY", value: apiKeySecret }],
                    ports: [{ containerPort: 8000 }],
                }],
            },
        },
    },
}, { provider, dependsOn: [nodeGroup] });

// 10. LoadBalancer Service
const service = new k8s.core.v1.Service("app-svc", {
    metadata: { namespace: ns.metadata.name, labels: appLabels },
    spec: {
        type: "LoadBalancer",
        ports: [{ port: 80, targetPort: 8000 }],
        selector: appLabels,
    },
}, { provider });

// 11. Exports
export const kubeconfig = cluster.kubeconfig;
export const url = service.status.loadBalancer.ingress[0].hostname;

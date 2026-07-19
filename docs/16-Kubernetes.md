# Kubernetes Deployment Architecture

## 1. Workload Specifications & Helm Configuration

```yaml
# Helm values.yaml snippet for Gateway API
replicaCount: 3
image:
  repository: ghcr.io/anupamajain/businessos-gateway-api
  tag: latest
  pullPolicy: IfNotPresent

autoscaling:
  enabled: true
  minReplicas: 3
  maxReplicas: 20
  targetCPUUtilizationPercentage: 75
  targetMemoryUtilizationPercentage: 80

resources:
  requests:
    cpu: 250m
    memory: 512Mi
  limits:
    cpu: 1000m
    memory: 1024Mi
```

# Disaster Recovery & Business Continuity

## 1. RPO & RTO Objectives
- **Recovery Point Objective (RPO)**: $\le 1\text{ minute}$ (PostgreSQL Point-in-Time Recovery).
- **Recovery Time Objective (RTO)**: $\le 15\text{ minutes}$ (Automated Multi-Region Failover).

## 2. Backup Strategy
- Automated daily database snapshots with 35-day retention.
- Cross-region database replication.

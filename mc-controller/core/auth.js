import jwt from 'jsonwebtoken';
import config from '../config.js';

const registeredAgents = new Map();

export function registerAgent(agentId) {
  if (registeredAgents.has(agentId)) {
    return { token: generateToken(agentId), existing: true };
  }
  registeredAgents.set(agentId, { registeredAt: Date.now() });
  return { token: generateToken(agentId), existing: false };
}

export function generateToken(agentId) {
  return jwt.sign({ agentId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}

export function getRegisteredAgents() {
  return [...registeredAgents.keys()];
}

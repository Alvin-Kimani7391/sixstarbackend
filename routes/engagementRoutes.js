const express = require('express');
const router = express.Router();

const {
  getMyNotifications, markNotificationRead, markAllNotificationsRead,
  getLeaderboard, listAchievementDefinitions, getMyAchievements, getAcademyContent,
} = require('../controllers2/engagementController');

const { protectAgent, requireActiveAgent } = require('../middleware/agentAuthMiddleware');

router.get('/leaderboard', getLeaderboard); // public-ish leaderboard, no auth required to view
router.get('/achievements', listAchievementDefinitions);

router.use(protectAgent, requireActiveAgent);
router.get('/notifications', getMyNotifications);
router.patch('/notifications/:id/read', markNotificationRead);
router.patch('/notifications/read-all', markAllNotificationsRead);
router.get('/my-achievements', getMyAchievements);
router.get('/academy', getAcademyContent);

module.exports = router;
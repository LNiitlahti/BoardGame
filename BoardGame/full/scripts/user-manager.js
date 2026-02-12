/**
 * USER MANAGER
 * Handles user roles and permissions
 */

class UserManager {
    constructor() {
        this.db = null;
        this.currentUser = null;
        this.userRole = null;
    }

    initialize(db, user) {
        this.db = db;
        this.currentUser = user;
        return this.loadUserRole();
    }

    async loadUserRole() {
        if (!this.currentUser || !this.db) {
            return null;
        }

        try {
            const userDoc = await this.db.collection('users').doc(this.currentUser.uid).get();
            
            if (userDoc.exists) {
                this.userRole = userDoc.data();
                return this.userRole;
            } else {
                // Create user document if it doesn't exist
                this.userRole = {
                    email: this.currentUser.email,
                    isAdmin: false,
                    createdAt: new Date().toISOString(),
                    lastLogin: new Date().toISOString()
                };
                
                await this.db.collection('users').doc(this.currentUser.uid).set(this.userRole);
                return this.userRole;
            }
        } catch (error) {
            console.error('Error loading user role:', error);
            return null;
        }
    }

    isAdmin() {
        return this.userRole?.isAdmin === true;
    }

    async updateLastLogin() {
        if (!this.currentUser || !this.db) return;

        try {
            await this.db.collection('users').doc(this.currentUser.uid).update({
                lastLogin: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error updating last login:', error);
        }
    }

    async setAdminStatus(userId, isAdmin) {
        if (!this.isAdmin()) {
            throw new Error('Only admins can modify admin status');
        }

        try {
            await this.db.collection('users').doc(userId).update({
                isAdmin: isAdmin
            });
            return true;
        } catch (error) {
            console.error('Error setting admin status:', error);
            throw error;
        }
    }

    async getAllUsers() {
        if (!this.isAdmin()) {
            throw new Error('Only admins can view all users');
        }

        try {
            const snapshot = await this.db.collection('users').get();
            const users = [];
            snapshot.forEach(doc => {
                users.push({ uid: doc.id, ...doc.data() });
            });
            return users;
        } catch (error) {
            console.error('Error getting all users:', error);
            throw error;
        }
    }
}

// Make available globally
if (typeof window !== 'undefined') {
    window.UserManager = UserManager;
}
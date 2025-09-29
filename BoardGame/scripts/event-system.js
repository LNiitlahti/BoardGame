/**
 * EVENT SYSTEM
 * Provides event handling for the game engine
 */

class EventEmitter {
    constructor() {
        this.eventListeners = new Map();
    }
    
    /**
     * Register an event listener for a custom event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback function to execute when event is emitted.
     */
    on(event, callback) {
        if (!this.eventListeners.has(event)) this.eventListeners.set(event, []);
        this.eventListeners.get(event).push(callback);
    }

    /**
     * Remove an event listener for a custom event.
     * @param {string} event - Event name.
     * @param {function} callback - Callback function to remove.
     */
    off(event, callback) {
        if (this.eventListeners.has(event)) {
            const listeners = this.eventListeners.get(event);
            const index = listeners.indexOf(callback);
            if (index !== -1) listeners.splice(index, 1);
        }
    }
    
    /**
     * Emit an event with data.
     * @param {string} event - Event name.
     * @param {any} data - Data to pass to listeners.
     */
    emit(event, data) {
        if (this.eventListeners.has(event)) {
            this.eventListeners.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error(`Error in event listener for "${event}":`, error);
                }
            });
        }
    }
}

// Make EventEmitter available globally
window.EventEmitter = EventEmitter;
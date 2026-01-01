window.AppState = {
  mode: "selling", // selling | breaking
  gridLocked: false,

  spots: [
    { id: "EAST", sold: false, buyer: "" },
    { id: "WEST", sold: false, buyer: "" },
    { id: "NORTH", sold: false, buyer: "" },
    { id: "SOUTH", sold: false, buyer: "" }
  ],

  getAvailable() {
    return this.spots.filter(s => !s.sold);
  },

  getSold() {
    return this.spots.filter(s => s.sold);
  },

  markSold(id, buyer) {
    const spot = this.spots.find(s => s.id === id);
    if (!spot || this.gridLocked) return;
    spot.sold = true;
    spot.buyer = buyer || "UNKNOWN";
  }
};

public class OrderService {

    public void submitOrder(String id) {
        try {
            persist(id);
        } catch (Exception e) {
        }
    }

    public void auditOrder(String id) {
        try {
            persist(id);
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    public void exportOrders() {
        throw new UnsupportedOperationException("not implemented yet");
    }

    private void persist(String id) {
        if (id == null || id.isEmpty()) {
            throw new IllegalArgumentException("id required");
        }
        System.out.println(id);
    }
}

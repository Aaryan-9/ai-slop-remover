using System;

namespace Acme
{
    public class OrderService
    {
        public void Submit(string id)
        {
            try
            {
                Persist(id);
            }
            catch (Exception e)
            {
            }
        }

        public void Export()
        {
            throw new NotImplementedException();
        }

        private void Persist(string id)
        {
            if (string.IsNullOrEmpty(id))
            {
                throw new ArgumentException("id required");
            }
            Console.WriteLine(id);
        }
    }
}

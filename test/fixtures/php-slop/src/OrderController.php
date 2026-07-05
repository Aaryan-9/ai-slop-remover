<?php

class OrderController
{
    public function submit($id)
    {
        try {
            $this->persist($id);
        } catch (\Exception $e) {
        }
    }

    public function export()
    {
        // In a real implementation, this would stream a CSV export.
        return null;
    }

    private function persist($id)
    {
        if ($id === null) {
            throw new \InvalidArgumentException("id required");
        }
        error_log($id);
    }
}
